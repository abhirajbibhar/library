import { useSyncExternalStore } from 'react';
import { API_BASE } from '../config';

/**
 * Offline reading. A saved book is the whole PDF in the browser's Cache API; the service worker (public/sw.js)
 * answers the reader from it when there is no network. Notes, progress and the book list are kept as
 * "last known" copies by the service worker as you use the app.
 */
const OFFLINE_CACHE = 'library-offline-v1';
const API_CACHE = 'library-api-v1';
const INDEX_KEY = 'library.offline.index.v1';
const AUTO_KEY = 'library.offline.auto.v1';
export const DEFAULT_AUTO = 3; // how many recently read books are kept automatically

export interface OfflineEntry {
  at: number; // when it was saved or last opened
  size: number;
  pinned: boolean; // saved by you (never removed automatically)
}
type OfflineIndex = Record<string, OfflineEntry>;

export const offlineSupported = typeof caches !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

const enc = encodeURIComponent;
const pdfPath = (key: string) => `${new URL(API_BASE, window.location.origin).pathname}/documents/${enc(key)}`;

// ---------------------------------------------------------------- small observable index
function load(): OfflineIndex {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '{}') as OfflineIndex;
  } catch {
    return {};
  }
}
let index: OfflineIndex = typeof localStorage === 'undefined' ? {} : load();
let version = 0;
const listeners = new Set<() => void>();
function commit(next: OfflineIndex) {
  index = next;
  version += 1;
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    /* private mode: the cache still works, the list just isn't remembered */
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Re-renders when the set of saved books changes. */
export function useOffline(): { has: (key: string) => boolean; entries: [string, OfflineEntry][]; bytes: number } {
  useSyncExternalStore(subscribe, () => version);
  const entries = Object.entries(index).sort((a, b) => b[1].at - a[1].at);
  return { has: (key) => key in index, entries, bytes: entries.reduce((n, [, e]) => n + e.size, 0) };
}

export const isSavedOffline = (key: string) => key in index;

// ---------------------------------------------------------------- settings
export function getAutoCount(): number {
  const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(AUTO_KEY);
  const n = raw === null ? DEFAULT_AUTO : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_AUTO;
}
export function setAutoCount(n: number): void {
  localStorage.setItem(AUTO_KEY, String(n));
  void trimAuto();
}

// ---------------------------------------------------------------- saving and removing
/** Downloads the whole PDF into the offline cache. Throws if it can't (offline, too big for the device ...). */
export async function saveForOffline(key: string, pinned: boolean): Promise<void> {
  if (!offlineSupported) throw new Error('Offline reading isn’t supported in this browser');
  const res = await fetch(`${API_BASE}/documents/${enc(key)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? 'PDF not found' : `Download failed (${res.status})`);
  const size = Number(res.headers.get('Content-Length')) || 0;
  const cache = await caches.open(OFFLINE_CACHE);
  await cache.put(pdfPath(key), res);
  // Ask the browser not to evict it under storage pressure (it may ignore this)
  void navigator.storage?.persist?.();
  const existing = index[key];
  commit({ ...index, [key]: { at: Date.now(), size: size || existing?.size || 0, pinned: pinned || !!existing?.pinned } });
}

export async function removeOffline(key: string): Promise<void> {
  const cache = await caches.open(OFFLINE_CACHE);
  await cache.delete(pdfPath(key));
  const next = { ...index };
  delete next[key];
  commit(next);
}

/** Drops the oldest automatically kept books beyond the chosen number. */
async function trimAuto(): Promise<void> {
  const keep = getAutoCount();
  const auto = Object.entries(index).filter(([, e]) => !e.pinned).sort((a, b) => b[1].at - a[1].at);
  for (const [key] of auto.slice(keep)) await removeOffline(key).catch(() => {});
}

const slowConnection = () => {
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (c.saveData === true || c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || c.effectiveType === '3g');
};

/** Called when you open a book: keeps it (and your last few) available offline, unless the setting is off. */
export async function keepRecentOffline(key: string): Promise<void> {
  if (!offlineSupported || !navigator.onLine) return;
  const n = getAutoCount();
  const existing = index[key];
  if (existing) {
    commit({ ...index, [key]: { ...existing, at: Date.now() } }); // opened again: counts as recent
    return;
  }
  if (n === 0 || slowConnection()) return;
  try {
    await saveForOffline(key, false);
    await trimAuto();
  } catch (err) {
    console.warn('Could not save for offline reading:', err);
  }
}

/** Removes everything this app stored on this device (use before leaving a shared computer). */
export async function clearOfflineData(): Promise<void> {
  if (typeof caches !== 'undefined') {
    await caches.delete(OFFLINE_CACHE);
    await caches.delete(API_CACHE);
  }
  commit({});
}
