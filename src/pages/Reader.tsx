import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Check, FileDown, Highlighter, PanelRightClose, PanelRightOpen, RefreshCw, Save, StickyNote, X } from 'lucide-react';
import { PDFViewer, type PDFViewerRef } from '@embedpdf/react-pdf-viewer';
import type { AnnotationOp, AnnotationsFile, ViewState } from '../types';
import { WASM_URL, VIEWER_FONTS } from '../lib/viewer-assets';
import { updateMetadata, getMetadata, getAnnotations, patchAnnotations } from '../lib/db';
import { useReadingTimer } from '../hooks/useReadingTimer';
import { useLibraryStore } from '../store';
import { formatDay } from '../lib/format';
import { ANNOTATION_AUTHOR, API_BASE, PDF_LOAD_MODE } from '../config';

const PROGRESS_DEBOUNCE_MS = 1500;
const RESUME_ATTEMPTS = 10;
const RESUME_RETRY_MS = 400;
const RESUME_SETTLE_MS = 600;
const VIEW_SETTLE_MS = 300;
const ANNOTATION_SAVE_DEBOUNCE_MS = 1200; // autosave this long after the last annotation change
const ANNOTATION_RETRY_MS = 8000; // retry after a failed save
const ANNOTATION_SETTLE_MS = 400; // viewer events caused by our own import arrive asynchronously
const ANNOTATION_OPS_PER_REQUEST = 200;

type ResumeState = 'idle' | 'resuming' | 'failed';
type SaveStatus = { kind: 'success' | 'error' | 'info'; message: string } | null;

/** Annotation changes made on this device that the server doesn't have yet. */
interface PendingChanges {
  upserts: Map<string, number>; // annotation id -> page index (created or edited here)
  deletes: Map<string, number>; // annotation id -> page index (deleted here)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- annotation <-> JSON helpers
// The viewer's annotation API is only loosely typed here (as elsewhere in this file).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnnotationApi = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface ExportedItem { annotation: Record<string, any>; ctx?: unknown }

/** JSON turns Date into a string; the viewer wants Date objects back. */
function reviveDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveDates);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] =
        (k === 'created' || k === 'modified') && typeof v === 'string' && !Number.isNaN(Date.parse(v))
          ? new Date(v)
          : reviveDates(v);
    }
    return out;
  }
  return value;
}

/** Viewer annotation -> one "upsert" operation for the sidecar JSON. */
function toUpsertOp(item: ExportedItem): AnnotationOp | null {
  const a = item.annotation;
  if (typeof a.id !== 'string' || !a.id) return null;
  return {
    op: 'upsert',
    id: a.id,
    page: (typeof a.pageIndex === 'number' ? a.pageIndex : 0) + 1,
    type: String(a.type ?? ''),
    text: typeof a.custom?.text === 'string' ? a.custom.text : '', // selected text of a highlight
    note: typeof a.contents === 'string' ? a.contents : '',
    data: JSON.parse(JSON.stringify(a)), // plain JSON copy (drops functions / undefined, Dates -> ISO)
  };
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Makes the viewer show what the sidecar says. Safe to run repeatedly: existing annotations are updated in
 * place (never duplicated), deletions in the sidecar also remove annotations still baked into an old PDF,
 * and annotations edited on this device but not sent yet (`skip`) are left alone.
 */
async function applyAnnotationsToViewer(
  annotation: AnnotationApi,
  file: AnnotationsFile,
  skip: Set<string>,
  syncingRef: { current: boolean },
): Promise<void> {
  syncingRef.current = true; // our own changes must not be mistaken for user edits
  try {
    const existing = new Map<string, number>();
    for (const t of annotation.getAnnotations() as Array<{ object: { id: string; pageIndex: number } }>) {
      existing.set(t.object.id, t.object.pageIndex);
    }
    const toCreate: ExportedItem[] = [];
    for (const rec of Object.values(file.annotations)) {
      if (skip.has(rec.id)) continue;
      const at = existing.get(rec.id);
      if (rec.deleted) {
        if (at !== undefined) annotation.deleteAnnotation(at, rec.id);
        continue;
      }
      const data = reviveDates(rec.data) as ExportedItem['annotation'];
      if (at !== undefined) annotation.updateAnnotation(at, rec.id, data);
      else toCreate.push({ annotation: data });
    }
    if (toCreate.length) annotation.importAnnotations(toCreate);
    await sleep(ANNOTATION_SETTLE_MS);
  } finally {
    syncingRef.current = false;
  }
}

export default function Reader() {
  const { id: bookId } = useParams<{ id: string }>();
  const { getBook, getAnnotationsByBook, refresh: refreshStore } = useLibraryStore();
  const book = getBook(bookId ?? '');
  const id = book?.r2Key; // everything below talks to the Worker by the PDF's key
  const [showPanel, setShowPanel] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const storeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(storeTimerRef.current), []);
  // #/viewer/<id>?page=12 opens at that page instead of the saved position (annotation and quote links use this).
  const [searchParams] = useSearchParams();
  const wantedPageRef = useRef(0);
  wantedPageRef.current = Math.max(0, Math.floor(Number(searchParams.get('page')) || 0));
  const viewerRef = useRef<PDFViewerRef>(null);
  const theme = 'dark' as const; // the whole app is dark

  /** The PDF is streamed straight from this URL (HTTP range requests) – it is never downloaded as a whole first. */
  const [pdfSource, setPdfSource] = useState<{ url: string; etag: string | null } | null>(null);
  const [docName, setDocName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [viewerReady, setViewerReady] = useState(false);
  useReadingTimer(id, viewerReady); // real reading time, shown on Home
  const [resumeState, setResumeState] = useState<ResumeState>('idle');
  const [resumeTarget, setResumeTarget] = useState<number | null>(null);
  const [progressWarning, setProgressWarning] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [annotationsWarning, setAnnotationsWarning] = useState(false);
  /** Page the *other* device has reached (shown as a "Go to page" banner after a refresh). */
  const [remoteProgress, setRemoteProgress] = useState<number | null>(null);

  // --- Refs: values that change often but must not re-render or re-trigger effects ---
  /** Latest page/total reported by the viewer. */
  const progressRef = useRef({ lastPage: 1, totalPages: 0 });
  /** Last values successfully sent to the server (to skip redundant writes). */
  const lastSavedRef = useRef<{ lastPage: number; totalPages: number } | null>(null);
  /**
   * Progress is only persisted once we've restored the saved page. Otherwise the viewer's initial
   * "you are on page 1" event overwrote the user's real progress (the original bug).
   */
  const trackingRef = useRef(false);
  const resumeTargetRef = useRef<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryResumeRef = useRef<(() => Promise<void>) | null>(null);
  const startTrackingRef = useRef<(() => void) | null>(null);
  const isDirtyRef = useRef(false);
  const pendingRef = useRef<PendingChanges>({ upserts: new Map(), deletes: new Map() });
  /** While true, annotation events come from our own merge and must not count as user edits. */
  const syncingRef = useRef(false);
  /** Last annotations file we know from the server (null if it could not be loaded). */
  const sidecarRef = useRef<AnnotationsFile | null>(null);
  /** Counts annotation edits so a save can tell which edits happened while its request was in flight. */
  const editSeqRef = useRef(0);
  const lastEditRef = useRef<Map<string, number>>(new Map());
  const annSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Saves run one after another, never in parallel. */
  const flushQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  /** Zoom / scroll mode for this document. null until restored from the server or changed by the reader. */
  const viewRef = useRef<ViewState | null>(null);
  const lastSavedViewRef = useRef<string>('null');
  /** Reads the viewer's CURRENT zoom into viewRef (set up once the viewer is ready). */
  const captureViewRef = useRef<(() => void) | null>(null);
  /** `lastOpened` we last wrote (or loaded) – a newer value on the server means another device moved on. */
  const lastWrittenAtRef = useRef(0);

  const markDirty = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty;
    setIsDirty(dirty);
  }, []);

  // ------------------------------------------------------------------ progress persistence
  const flushProgress = useCallback(
    (keepalive = false) => {
      if (!id || !trackingRef.current) return;
      clearTimeout(saveTimerRef.current);

      const { lastPage, totalPages: total } = progressRef.current;
      if (total <= 0) return;

      captureViewRef.current?.();
      const view = viewRef.current;
      const viewKey = JSON.stringify(view);
      const prev = lastSavedRef.current;
      const prevViewKey = lastSavedViewRef.current;
      if (prev && prev.lastPage === lastPage && prev.totalPages === total && prevViewKey === viewKey) return;

      lastSavedRef.current = { lastPage, totalPages: total };
      lastSavedViewRef.current = viewKey;
      const stamp = new Date();
      lastWrittenAtRef.current = stamp.getTime();
      updateMetadata(
        id,
        { lastPage, totalPages: total, lastOpened: stamp.toISOString(), ...(view ? { view } : {}) },
        { keepalive },
      ).catch((err) => {
        lastSavedRef.current = prev; // allow a retry on the next change
        lastSavedViewRef.current = prevViewKey;
        console.error('Failed to save progress:', err);
      });
    },
    [id],
  );

  // ------------------------------------------------------------------ status toast
  const showStatus = useCallback((status: SaveStatus) => {
    setSaveStatus(status);
    clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setSaveStatus(null), 4000);
  }, []);

  useEffect(() => () => clearTimeout(statusTimerRef.current), []);

  // ------------------------------------------------------------------ annotation persistence (sidecar JSON)
  /** Always points at the latest flushAnnotations, so timers and event handlers never use a stale copy. */
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);

  const scheduleAnnotationSave = useCallback((delay = ANNOTATION_SAVE_DEBOUNCE_MS) => {
    clearTimeout(annSaveTimerRef.current);
    annSaveTimerRef.current = setTimeout(() => void flushRef.current?.(), delay);
  }, []);

  /**
   * Sends this device's annotation changes to Annotation/<folder>/<name>.json. Only what changed is sent
   * (never the 50 MB PDF). Resolves true when everything is saved, false if the save failed (it retries itself).
   */
  const flushAnnotations = useCallback((): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      if (!id) return true;
      clearTimeout(annSaveTimerRef.current);
      const { upserts, deletes } = pendingRef.current;
      if (upserts.size === 0 && deletes.size === 0) {
        markDirty(false);
        return true;
      }

      const seqAtStart = editSeqRef.current;
      const upIds = new Set(upserts.keys());
      const delIds = [...deletes.keys()];
      try {
        const ops: AnnotationOp[] = [];
        if (upIds.size > 0) {
          const registry = await viewerRef.current?.registry;
          const annotation = registry?.getPlugin('annotation')?.provides?.();
          if (!annotation) throw new Error('Viewer is not ready yet');
          await annotation.commit().toPromise();
          const exported = (await annotation.exportAnnotations().toPromise()) as ExportedItem[];
          for (const item of exported) {
            const annId = item.annotation.id;
            if (typeof annId !== 'string' || !upIds.has(annId)) continue;
            const op = toUpsertOp(item);
            if (op) ops.push(op);
          }
        }
        for (const annId of delIds) ops.push({ op: 'delete', id: annId });

        if (ops.length > 0) {
          const batches = chunked(ops, ANNOTATION_OPS_PER_REQUEST);
          let rev = 0;
          for (const batch of batches) rev = await patchAnnotations(id, batch);
          const known = sidecarRef.current;
          // If nobody else wrote in between, our own writes are not "news" for the next Refresh.
          if (known && rev === known.rev + batches.length) known.rev = rev;
        }

        // Forget what was sent – but keep anything edited again while the request was in flight.
        for (const annId of [...upIds, ...delIds]) {
          if ((lastEditRef.current.get(annId) ?? 0) > seqAtStart) continue;
          upserts.delete(annId);
          deletes.delete(annId);
          lastEditRef.current.delete(annId);
        }
        if (upserts.size === 0 && deletes.size === 0) markDirty(false);
        else scheduleAnnotationSave();
        // Let the notes panel and the rest of the app pick up what was just saved.
        clearTimeout(storeTimerRef.current);
        storeTimerRef.current = setTimeout(() => void refreshStore(true), 2500);
        return true;
      } catch (err) {
        console.error('Failed to save annotations:', err);
        showStatus({ kind: 'error', message: "Couldn't save annotations – will retry" });
        scheduleAnnotationSave(ANNOTATION_RETRY_MS);
        return false;
      }
    };
    flushQueueRef.current = flushQueueRef.current.then(run);
    return flushQueueRef.current;
  }, [id, markDirty, showStatus, scheduleAnnotationSave, refreshStore]);

  useEffect(() => {
    flushRef.current = flushAnnotations;
  }, [flushAnnotations]);

  // ------------------------------------------------------------------ load document
  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    const controller = new AbortController();

    // The route component is reused when :id changes, so reset everything per document.
    trackingRef.current = false;
    progressRef.current = { lastPage: 1, totalPages: 0 };
    lastSavedRef.current = null;
    resumeTargetRef.current = null;
    sidecarRef.current = null;
    lastEditRef.current = new Map();
    clearTimeout(annSaveTimerRef.current);
    captureViewRef.current = null;
    viewRef.current = null;
    lastSavedViewRef.current = 'null';
    pendingRef.current = { upserts: new Map(), deletes: new Map() };
    setPdfSource(null);
    setViewerReady(false);
    setLoading(true);
    setError(null);
    setTotalPages(0);
    setResumeState('idle');
    setResumeTarget(null);
    setProgressWarning(false);
    setAnnotationsWarning(false);
    setRemoteProgress(null);
    markDirty(false);
    setDocName(id.split('/').pop()?.replace(/\.pdf$/i, '') || 'Document');

    (async () => {
      try {
        const pdfUrl = `${API_BASE}/documents/${encodeURIComponent(id)}`;
        const [head, sidecar, meta] = await Promise.all([
          // HEAD only: confirms the PDF exists and returns its ETag. The bytes themselves are streamed by the
          // viewer in small ranges, so page 1 can appear without downloading the whole file.
          fetch(pdfUrl, { method: 'HEAD', signal: controller.signal, cache: 'no-store' }),
          // Annotations live in Annotation/<folder>/<name>.json. A failed lookup must not block reading.
          getAnnotations(id, { signal: controller.signal }).catch((err) => {
            if (err?.name !== 'AbortError') console.warn('Could not load saved annotations:', err);
            return null;
          }),
          // A failed progress lookup must not block reading, but we also must not overwrite progress we couldn't read.
          getMetadata(id, { signal: controller.signal }).catch((err) => {
            if (err?.name !== 'AbortError') console.warn('Could not load saved progress:', err);
            return null;
          }),
        ]);
        if (cancelled) return;
        if (!head.ok) throw new Error(head.status === 404 ? 'PDF not found' : `Failed to open PDF (${head.status})`);
        sidecarRef.current = sidecar;
        setAnnotationsWarning(!sidecar);

        if (meta) {
          lastWrittenAtRef.current = meta.lastOpened ? Date.parse(meta.lastOpened) || 0 : 0;
          const lastPage = Math.max(1, meta.lastPage || 1);
          progressRef.current = { lastPage, totalPages: meta.totalPages || 0 };
          lastSavedRef.current = { ...progressRef.current };
          viewRef.current = meta.view ?? null;
          lastSavedViewRef.current = JSON.stringify(viewRef.current);
          const startPage = wantedPageRef.current >= 1 ? wantedPageRef.current : lastPage;
          resumeTargetRef.current = startPage > 1 ? startPage : null;
          setResumeTarget(resumeTargetRef.current);
          if (startPage > 1) setResumeState('resuming');
        } else {
          setProgressWarning(true); // tracking stays off for this session
        }

        setPdfSource({ url: pdfUrl, etag: head.headers.get('ETag') });
        setLoading(false);
      } catch (err) {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        console.error('Failed to load document:', err);
        setError(err instanceof Error ? err.message : 'Failed to load document');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      flushProgress(true); // save on leave / on switching to another document
      clearTimeout(saveTimerRef.current);
      clearTimeout(annSaveTimerRef.current);
    };
  }, [id, flushProgress, markDirty]);

  // Save progress when the tab is hidden/closed (mobile browsers often kill tabs without unmount).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress(true);
        void flushRef.current?.(); // best effort: save annotations when the tab goes to the background
      }
    };
    const onPageHide = () => flushProgress(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flushProgress]);

  // Warn before closing the tab with unsaved annotations.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // ------------------------------------------------------------------ wire up the viewer
  useEffect(() => {
    if (!viewerReady || !id) return;

    let disposed = false;
    let begun = false;
    const unsubscribers: Array<() => void> = [];

    const setup = async () => {
      const registry = await viewerRef.current?.registry;
      if (!registry || disposed) return;
      await registry.pluginsReady();
      if (disposed) return;

      const scroll = registry.getPlugin('scroll')?.provides?.();
      if (!scroll) return;
      const zoom = registry.getPlugin('zoom')?.provides?.();
      const annotation = registry.getPlugin('annotation')?.provides?.();

      // Subscribe BEFORE the document finishes loading: we need the "loaded" event, and we track user edits.
      let resolveLoaded: () => void = () => {};
      const annotationsLoaded = new Promise<void>((resolve) => {
        resolveLoaded = resolve;
      });
      const unsubAnnotations = annotation?.onAnnotationEvent?.(
        (event: { type: string; pageIndex?: number; annotation?: { id?: string } }) => {
          if (event.type === 'loaded') {
            resolveLoaded();
            return;
          }
          if (syncingRef.current) return; // our own import, not a user edit
          if (event.type !== 'create' && event.type !== 'update' && event.type !== 'delete') return;
          markDirty(true);
          const annId = event.annotation?.id;
          if (!annId || event.pageIndex === undefined) return;
          const { upserts, deletes } = pendingRef.current;
          if (event.type === 'delete') {
            upserts.delete(annId);
            deletes.set(annId, event.pageIndex);
          } else {
            deletes.delete(annId);
            upserts.set(annId, event.pageIndex);
          }
          lastEditRef.current.set(annId, ++editSeqRef.current);
          scheduleAnnotationSave(); // autosave shortly after the last change
        },
      );
      if (typeof unsubAnnotations === 'function') unsubscribers.push(unsubAnnotations);

      const target = resumeTargetRef.current;
      const canTrack = () => !progressWarning;

      const readZoom = (): ViewState['zoom'] | undefined => {
        try {
          const st = zoom?.getState();
          if (!st) return undefined;
          return typeof st.zoomLevel === 'string' ? st.zoomLevel : Math.round(st.currentZoomLevel * 100) / 100;
        } catch {
          return undefined; // zoom state unavailable
        }
      };
      let zoomAtStart: ViewState['zoom'] | undefined;

      const startTracking = () => {
        if (disposed || !canTrack()) return;
        zoomAtStart = readZoom(); // whatever the viewer opened with (restored or default) is not a "change"
        trackingRef.current = true;
        lastSavedRef.current = null; // force one save so "last opened" is refreshed
        setResumeState('idle');
        flushProgress();
      };
      startTrackingRef.current = startTracking;

      // Jump to the saved page and verify we REALLY stayed there. scrollToPage() fires a "page N" event
      // immediately – before the viewport has moved – and the viewer can then snap back to the top while it
      // finishes laying out. So we never trust the event: we re-check the actual current page after a short
      // settle time, and keep re-issuing the jump until it sticks.
      const tryResume = async (page: number): Promise<boolean> => {
        for (let i = 0; i < RESUME_ATTEMPTS && !disposed; i++) {
          try {
            scroll.scrollToPage({ pageNumber: page, behavior: 'instant' });
          } catch (err) {
            console.warn(`Resume attempt ${i + 1} failed:`, err);
          }
          await sleep(RESUME_RETRY_MS);
          if (scroll.getCurrentPage?.() !== page) continue;
          await sleep(RESUME_SETTLE_MS); // still there after the layout settled?
          if (scroll.getCurrentPage?.() === page) return true;
        }
        return false;
      };

      retryResumeRef.current = async () => {
        if (!target) return;
        setResumeState('resuming');
        const ok = await tryResume(target);
        if (disposed) return;
        if (ok) startTracking();
        else setResumeState('failed');
      };

      // Put back the zoom level and scroll mode saved for this document (before jumping to the saved page,
      // because both change the layout the page position depends on).
      const applyView = async () => {
        const v = viewRef.current;
        if (!v) return;
        try {
          if (v.scrollMode) scroll.setScrollStrategy(v.scrollMode as never);
        } catch (err) {
          console.warn('Could not restore scroll mode:', err);
        }
        try {
          if (v.zoom !== undefined) zoom?.requestZoom(v.zoom as never);
        } catch (err) {
          console.warn('Could not restore zoom:', err);
        }
        await sleep(VIEW_SETTLE_MS);
      };

      const begin = async (total: number) => {
        if (begun || disposed) return;
        begun = true;
        if (total > 0) {
          progressRef.current = { ...progressRef.current, totalPages: total };
          setTotalPages(total);
        }
        await applyView();
        if (disposed) return;
        if (target && target > 1 && (total === 0 || target <= total)) {
          const ok = await tryResume(target);
          if (disposed) return;
          if (ok) startTracking();
          else setResumeState('failed'); // tracking stays off so we don't clobber the saved page
        } else {
          startTracking();
        }
      };

      unsubscribers.push(
        scroll.onPageChange((event: { pageNumber: number; totalPages: number }) => {
          setTotalPages(event.totalPages);
          if (!trackingRef.current) return; // still restoring – ignore the transient "page 1"

          progressRef.current = { lastPage: event.pageNumber, totalPages: event.totalPages };
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => flushProgress(), PROGRESS_DEBOUNCE_MS);
        }),
      );

      // Remember zoom / scroll-mode changes (ignored while we are still restoring, like page changes).
      const scheduleViewSave = () => {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => flushProgress(), PROGRESS_DEBOUNCE_MS);
      };
      // The zoom event's `level` is unreliable (for zoom-in/out it still holds the OLD level), so we only use
      // the event as a trigger and read the viewer's actual state when saving: a mode ("fit-width"…) stays a
      // mode so it adapts to each screen, a manual zoom is stored as the real scale factor.
      captureViewRef.current = () => {
        const level = readZoom();
        if (level === undefined || viewRef.current?.zoom === level) return;
        if (!viewRef.current?.zoom && level === zoomAtStart) return; // untouched – nothing worth saving
        viewRef.current = { ...viewRef.current, zoom: level };
      };
      const unsubZoom = zoom?.onZoomChange?.(() => {
        if (trackingRef.current) scheduleViewSave();
      });
      if (unsubZoom) unsubscribers.push(unsubZoom);
      const unsubStrategy = scroll.onStateChange?.((state: { strategy?: string }) => {
        if (!trackingRef.current || !state?.strategy) return;
        const mode = state.strategy as ViewState['scrollMode'];
        if (viewRef.current?.scrollMode === mode) return;
        if (!viewRef.current?.scrollMode && mode === 'vertical') return; // default
        viewRef.current = { ...viewRef.current, scrollMode: mode };
        scheduleViewSave();
      });
      if (unsubStrategy) unsubscribers.push(unsubStrategy);

      // Start as soon as the layout is ready (replaces the old fixed 1-second setTimeout)…
      unsubscribers.push(
        scroll.onLayoutReady((event: { totalPages: number }) => {
          void begin(event.totalPages);
        }),
      );
      // …or right away if it was already ready before we subscribed.
      const alreadyTotal = scroll.getTotalPages?.() || 0;
      if (alreadyTotal > 0) void begin(alreadyTotal);

      // Show the saved annotations once the PDF's own annotations have been read. The first time a PDF is
      // opened with this scheme (no sidecar yet) its embedded annotations are copied into the sidecar once.
      const syncAnnotations = async () => {
        const file = sidecarRef.current;
        if (!annotation || !file) return;
        // Layout already there => the document is open and "loaded" probably fired before we subscribed.
        await Promise.race([annotationsLoaded, sleep((scroll.getTotalPages?.() || 0) > 0 ? 1000 : 8000)]);
        if (disposed) return;
        try {
          if (file.rev === 0) {
            const exported = (await annotation.exportAnnotations().toPromise()) as ExportedItem[];
            const ops = exported.map(toUpsertOp).filter((op): op is AnnotationOp => op !== null);
            if (ops.length > 0) {
              let rev = 0;
              for (const batch of chunked(ops, ANNOTATION_OPS_PER_REQUEST)) rev = await patchAnnotations(id, batch);
              file.rev = rev;
            }
          } else {
            await applyAnnotationsToViewer(annotation, file, new Set(pendingRef.current.upserts.keys()), syncingRef);
          }
        } catch (err) {
          console.error('Failed to load annotations:', err);
          showStatus({ kind: 'error', message: "Couldn't load saved annotations" });
        }
      };
      void syncAnnotations();
    };

    void setup();

    return () => {
      disposed = true;
      unsubscribers.forEach((u) => u());
      startTrackingRef.current = null;
      captureViewRef.current = null;
      retryResumeRef.current = null;
    };
  }, [viewerReady, id, flushProgress, markDirty, progressWarning, scheduleAnnotationSave, showStatus]);

  // ------------------------------------------------------------------ manual save (autosave does the same)
  const handleSave = useCallback(async () => {
    if (!id || isSaving) return;
    setIsSaving(true);
    setSaveStatus(null);
    try {
      // flushAnnotations reports its own errors (and keeps retrying), so only the success case needs a message.
      if (await flushAnnotations()) {
        flushProgress();
        showStatus({ kind: 'success', message: 'Saved' });
      }
    } finally {
      setIsSaving(false);
    }
  }, [id, isSaving, flushAnnotations, flushProgress, showStatus]);

  // ------------------------------------------------------------------ refresh / sync with other devices
  /**
   * Sends this device's unsaved annotation changes, then pulls what other devices saved into the running
   * viewer (no reload, no PDF download – annotations are separate from the PDF) plus their reading progress.
   */
  const handleRefresh = useCallback(async () => {
    if (!viewerRef.current || !id || isSyncing || isSaving) return;

    setIsSyncing(true);
    setSaveStatus(null);
    setRemoteProgress(null);

    try {
      const registry = await viewerRef.current.registry;
      const annotation = registry?.getPlugin('annotation')?.provides?.();
      const scroll = registry?.getPlugin('scroll')?.provides?.();
      if (!annotation || !scroll) throw new Error('Viewer is not ready yet');

      // 1. Our own edits first, so nothing is lost.
      if (!(await flushAnnotations())) throw new Error("Couldn't save your changes – check your connection");

      // 2. What the other devices saved. The server merges per annotation, so there is nothing to resolve here.
      const fresh = await getAnnotations(id);
      const changed = fresh.rev !== (sidecarRef.current?.rev ?? 0);
      sidecarRef.current = fresh;
      setAnnotationsWarning(false);
      if (changed) {
        await applyAnnotationsToViewer(annotation, fresh, new Set(pendingRef.current.upserts.keys()), syncingRef);
      }

      // 3. Reading progress from the other device.
      const meta = await getMetadata(id).catch(() => null);
      if (meta && meta.lastOpened) {
        const current = scroll.getCurrentPage?.() ?? progressRef.current.lastPage;
        const newer = Date.parse(meta.lastOpened) > lastWrittenAtRef.current + 1000;
        if (newer && meta.lastPage && meta.lastPage !== current) setRemoteProgress(meta.lastPage);
      }

      showStatus({ kind: 'success', message: changed ? 'Updated' : 'Up to date' });
    } catch (err) {
      console.error('Refresh failed:', err);
      showStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Refresh failed' });
    } finally {
      setIsSyncing(false);
    }
  }, [id, isSyncing, isSaving, flushAnnotations, showStatus]);

  const goToRemotePage = useCallback(async () => {
    const page = remoteProgress;
    setRemoteProgress(null);
    if (!page || !viewerRef.current) return;
    const registry = await viewerRef.current.registry;
    registry?.getPlugin('scroll')?.provides?.()?.scrollToPage({ pageNumber: page, behavior: 'smooth' });
  }, [remoteProgress]);

  // Ctrl/Cmd+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave]);

  const confirmLeave = (e: React.MouseEvent) => {
    if (isDirtyRef.current && !window.confirm('Your latest annotations are still being saved. Leave anyway?')) {
      e.preventDefault();
    }
  };

  // Export: the PDF together with its highlights and notes (so it opens with them in any PDF app)
  const [isExporting, setIsExporting] = useState(false);
  const handleExport = useCallback(async () => {
    if (!viewerRef.current || isExporting) return;
    setIsExporting(true);
    try {
      const registry = await viewerRef.current.registry;
      const annotation = registry?.getPlugin('annotation')?.provides?.();
      await annotation?.commit?.()?.toPromise?.(); // make sure pending edits are part of the file
      await flushAnnotations(); // and in your saved notes
      const exporter = registry?.getPlugin('export')?.provides?.();
      if (!exporter?.download) throw new Error("Export isn't available here. Try the download button in the viewer's toolbar.");
      exporter.download();
      showStatus({ kind: 'success', message: 'Exported with annotations' });
    } catch (err) {
      console.error('Export failed:', err);
      showStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Export failed' });
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, flushAnnotations, showStatus]);

  // Jump to a page from the notes panel
  const goToPage = useCallback(async (page: number) => {
    const registry = await viewerRef.current?.registry;
    registry?.getPlugin('scroll')?.provides?.()?.scrollToPage({ pageNumber: page, behavior: 'smooth' });
    if (window.innerWidth < 640) setShowPanel(false);
  }, []);

  // ------------------------------------------------------------------ render
  const notes = book ? getAnnotationsByBook(book.id) : [];
  const backTo = book ? `/book/${book.id}` : '/library';

  if (!book) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 text-lg">Book not found</p>
          <Link to="/library" className="text-blue-400 mt-4 inline-block hover:text-blue-300">Back to Library</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-300 font-medium">Opening {book.title}…</p>
        </div>
      </div>
    );
  }

  if (error || !pdfSource) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <h2 className="text-xl font-bold text-white mb-2">Couldn’t open this book</h2>
          <p className="text-gray-400 mb-6">{error || 'Could not load the PDF document.'}</p>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => window.location.reload()} className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-md text-sm font-medium transition-colors">Try again</button>
            <Link to={backTo} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors">Back to book</Link>
          </div>
        </div>
      </div>
    );
  }

  const highlights = notes.filter((a) => a.type === 'highlight');
  const plain = notes.filter((a) => a.type === 'note');

  return (
    <div className="h-full w-full max-w-full flex flex-col bg-gray-950 overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 px-2 sm:px-3 py-2 border-b border-gray-800 bg-gray-900 flex-shrink-0 z-20">
        <div className="flex items-center gap-1 sm:gap-2 min-w-0">
          <Link to={backTo} onClick={confirmLeave} aria-label="Back to book" title="Back to book" className="p-2 rounded-md hover:bg-gray-800 text-gray-400 transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-sm font-medium text-white truncate max-w-[40vw] sm:max-w-[320px] lg:max-w-none" title={docName}>{docName}</h1>
            <p className="text-xs text-gray-500 hidden sm:block truncate">{book.genre}{totalPages > 0 ? ` · ${totalPages} pages` : ''}</p>
          </div>
          {isDirty && <span className="shrink-0 text-[10px] sm:text-xs font-medium text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded">Unsaved</span>}
        </div>

        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <div aria-live="polite">
            {saveStatus?.kind === 'success' && (
              <div className="flex items-center gap-1 text-green-300 bg-green-500/10 px-2.5 py-1.5 rounded-md text-xs font-medium animate-fade-in">
                <Check className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{saveStatus.message === 'Saved' ? 'Saved!' : saveStatus.message}</span>
              </div>
            )}
            {saveStatus?.kind === 'error' && (
              <div className="flex items-center gap-1 text-red-300 bg-red-500/10 px-2.5 py-1.5 rounded-md text-xs font-medium animate-fade-in max-w-[10rem] sm:max-w-xs" title={saveStatus.message}>
                <X className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{saveStatus.message}</span>
              </div>
            )}
          </div>

          <button onClick={handleRefresh} disabled={isSyncing || isSaving} title="Refresh: pull the latest annotations and progress from your other devices" aria-label="Refresh and sync"
            className="p-2 rounded-md text-gray-300 hover:bg-gray-800 disabled:opacity-50 transition-colors">
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => void handleExport()} disabled={isExporting} title="Export this PDF with your highlights and notes" aria-label="Export PDF with annotations"
            className="p-2 rounded-md text-gray-300 hover:bg-gray-800 disabled:opacity-50 transition-colors">
            <FileDown className="w-4 h-4" />
          </button>
          <button onClick={handleSave} disabled={isSaving || isSyncing} title="Save now (annotations also save automatically): Ctrl/⌘+S" aria-label="Save"
            className="p-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors">
            {isSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
          </button>
          <button onClick={() => setShowPanel((v) => !v)} aria-pressed={showPanel} title="Notes and highlights"
            className={`p-2 rounded-md transition-colors flex items-center gap-2 ${showPanel ? 'bg-blue-500/20 text-blue-400' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
            {showPanel ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
            <span className="text-xs hidden lg:inline">{notes.length} notes</span>
          </button>
        </div>
      </div>

      {/* Resume / progress banners */}
      {resumeState === 'resuming' && resumeTarget && (
        <div className="bg-blue-500/10 border-b border-blue-500/20 px-4 py-2 text-center text-sm text-blue-200">
          Opening at page {resumeTarget}{totalPages > 0 && <span className="text-blue-300/70"> of {totalPages}</span>}
        </div>
      )}
      {resumeState === 'failed' && resumeTarget && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex flex-wrap items-center justify-center gap-3 text-sm text-amber-200">
          <span>Couldn’t jump to page {resumeTarget}. Progress saving is paused so it isn’t overwritten.</span>
          <button onClick={() => retryResumeRef.current?.()} className="font-medium underline">Go to page {resumeTarget}</button>
          <button onClick={() => startTrackingRef.current?.()} className="font-medium underline">Start from here</button>
        </div>
      )}
      {remoteProgress && (
        <div className="bg-blue-500/10 border-b border-blue-500/20 px-4 py-2 flex flex-wrap items-center justify-center gap-3 text-sm text-blue-200">
          <span>Your other device is on page {remoteProgress}.</span>
          <button onClick={goToRemotePage} className="font-medium underline">Go to page {remoteProgress}</button>
          <button onClick={() => setRemoteProgress(null)} className="font-medium underline opacity-70">Dismiss</button>
        </div>
      )}
      {annotationsWarning && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-center text-sm text-amber-200">
          Couldn’t load your saved annotations. Tap Refresh to try again. New annotations will still be saved.
        </div>
      )}
      {progressWarning && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-center text-sm text-amber-200">
          Couldn’t load your saved progress, so progress saving is off for this session.
        </div>
      )}

      <div className="flex-1 flex min-h-0 relative">
        {/* PDF viewer */}
        <div className="flex-1 min-w-0 min-h-0">
          <PDFViewer
            ref={viewerRef}
            style={{ width: '100%', height: '100%' }}
            config={{
              // Stream the PDF from the worker URL (HTTP range requests) instead of handing the viewer a finished
              // blob. If-Match pins every range request to the version we checked, so a file replaced mid-read
              // fails cleanly (412) instead of mixing two versions.
              documentManager: {
                initialDocuments: [
                  {
                    url: pdfSource.url,
                    name: docName || 'Document',
                    mode: PDF_LOAD_MODE,
                    requestOptions: pdfSource.etag ? { headers: { 'If-Match': pdfSource.etag } } : undefined,
                  },
                ],
              },
              wasmUrl: WASM_URL,
              fontFallback: null, // PDFs embed their own fonts, so no fallback fonts to host or download
              fonts: VIEWER_FONTS,
              stamp: { manifests: [] }, // don't fetch the default stamp library from a CDN
              theme: { preference: theme, dark: { accent: { primary: '#3b82f6' } } },
              annotations: { annotationAuthor: ANNOTATION_AUTHOR },
              disabledCategories: [
                'annotation-shape',
                'insert',
                'form',
                'redaction',
                'document-open',
                'document-close',
                'document-print',
                'document-protect',
                'security',
              ],
            }}
            onReady={() => setViewerReady(true)}
          />
        </div>

        {/* Notes and highlights for this book */}
        {showPanel && (
          <aside className="fixed sm:static inset-0 sm:inset-auto sm:w-80 border-l border-gray-800 bg-gray-900 flex flex-col overflow-hidden flex-shrink-0 z-30" aria-label="Notes and highlights">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
              <h2 className="text-sm font-semibold text-white">Notes &amp; highlights</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-md">{notes.length}</span>
                <button onClick={() => setShowPanel(false)} className="p-1.5 rounded hover:bg-gray-800 text-gray-400" aria-label="Close panel"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {highlights.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-yellow-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Highlighter className="w-3 h-3" />Highlights ({highlights.length})</h3>
                  <div className="space-y-2">
                    {[...highlights].sort((a, b) => a.page - b.page).map((h) => (
                      <button key={h.id} onClick={() => void goToPage(h.page)} className="w-full text-left p-2.5 rounded-lg border bg-yellow-500/5 border-yellow-500/10 hover:border-yellow-500/30 transition-colors">
                        <p className="text-xs text-yellow-100/80 italic line-clamp-3">“{h.content}”</p>
                        {h.comment && <p className="text-xs text-gray-300 mt-1.5 line-clamp-3">{h.comment}</p>}
                        <p className="text-[10px] text-gray-500 mt-1.5">Page {h.page} · {formatDay(h.updatedAt)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {plain.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-purple-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><StickyNote className="w-3 h-3" />Notes ({plain.length})</h3>
                  <div className="space-y-2">
                    {[...plain].sort((a, b) => a.page - b.page).map((n) => (
                      <button key={n.id} onClick={() => void goToPage(n.page)} className="w-full text-left p-2.5 rounded-lg border bg-purple-500/5 border-purple-500/10 hover:border-purple-500/30 transition-colors">
                        <p className="text-xs text-gray-300 line-clamp-4 whitespace-pre-line">{n.content}</p>
                        <p className="text-[10px] text-gray-500 mt-1.5">Page {n.page} · {formatDay(n.updatedAt)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {notes.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-12 h-12 rounded-xl bg-gray-800 flex items-center justify-center mx-auto mb-3"><StickyNote className="w-6 h-6 text-gray-600" /></div>
                  <p className="text-gray-500 text-sm">No annotations yet</p>
                  <p className="text-gray-600 text-xs mt-1">Select text in the PDF to highlight it, or use the toolbar to add a note.</p>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
