import type { PdfDocument } from '../types';

export type DocStatus = 'new' | 'reading' | 'done';

export const isFinished = (d: PdfDocument) => d.totalPages > 0 && d.lastPage >= d.totalPages;
export const statusOf = (d: PdfDocument): DocStatus => (isFinished(d) ? 'done' : d.totalPages === 0 ? 'new' : 'reading');
export const progressPct = (d: PdfDocument) =>
  d.totalPages > 0 ? Math.min(100, Math.round((d.lastPage / d.totalPages) * 100)) : 0;

export const viewerPath = (id: string) => `/viewer/${encodeURIComponent(id)}`;
export const folderPath = (folder: string) => `/folder/${encodeURIComponent(folder)}`;

/** "Page 42 of 78" / "Finished" / "Not started" */
export function progressLabel(d: PdfDocument): string {
  const s = statusOf(d);
  if (s === 'done') return 'Finished';
  if (s === 'new') return 'Not started';
  return `Page ${d.lastPage} of ${d.totalPages}`;
}

export function formatSize(bytes: number): string {
  if (!bytes) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2).replace(/0$/, '')} GB`;
}

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Today / Yesterday / Mon … / 11 Oct / 11 Oct 2025 */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / DAY);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  const base = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

const COVER_COLORS = ['#4f46e5', '#0f766e', '#9a3412', '#1e3a5f', '#9d174d', '#854d0e', '#3f6212'];

/** Stable cover colour per title (all have ≥4.5:1 contrast with white text). */
export function coverColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COVER_COLORS[h % COVER_COLORS.length];
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
