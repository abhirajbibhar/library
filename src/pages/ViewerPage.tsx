import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PDFViewer, type PDFViewerRef } from '@embedpdf/react-pdf-viewer';
import type { AnnotationOp, AnnotationsFile, ViewState } from '../types';
import { WASM_URL, VIEWER_FONTS } from '../lib/viewer-assets';
import { updateMetadata, getMetadata, getAnnotations, patchAnnotations } from '../lib/db';
import { useTheme } from '../contexts/ThemeContext';
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

export default function ViewerPage() {
  const { id } = useParams<{ id: string }>();
  const viewerRef = useRef<PDFViewerRef>(null);
  const { theme } = useTheme();

  /** The PDF is streamed straight from this URL (HTTP range requests) – it is never downloaded as a whole first. */
  const [pdfSource, setPdfSource] = useState<{ url: string; etag: string | null } | null>(null);
  const [docName, setDocName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [viewerReady, setViewerReady] = useState(false);
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
  }, [id, markDirty, showStatus, scheduleAnnotationSave]);

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
          resumeTargetRef.current = lastPage > 1 ? lastPage : null;
          setResumeTarget(resumeTargetRef.current);
          if (lastPage > 1) setResumeState('resuming');
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

  // ------------------------------------------------------------------ render
  if (loading) {
    return (
      <div className="h-dvh flex items-center justify-center bg-gray-50 dark:bg-gray-900 transition-colors">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-200 dark:border-indigo-800 border-t-indigo-600 dark:border-t-indigo-400 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400 font-medium">Loading document from cloud...</p>
        </div>
      </div>
    );
  }

  if (error || !pdfSource) {
    return (
      <div className="h-dvh flex items-center justify-center bg-gray-50 dark:bg-gray-900 transition-colors">
        <div className="text-center max-w-md px-4">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-500 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Failed to Load</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">{error || 'Could not load the PDF document.'}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Try again
            </button>
            <Link
              to="/"
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Back to Library
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-dvh w-full max-w-full flex flex-col bg-gray-100 dark:bg-gray-900 overflow-hidden transition-colors"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Top Bar */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-2 sm:px-4 py-2 flex items-center justify-between shadow-sm z-10 transition-colors">
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          <Link
            to="/"
            onClick={confirmLeave}
            aria-label="Back to library"
            className="flex items-center gap-1 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 px-1.5 sm:px-2 py-1.5 rounded-md transition-colors text-xs sm:text-sm font-medium shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">Library</span>
          </Link>
          <div className="h-5 w-px bg-gray-200 dark:bg-gray-700 shrink-0"></div>
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-500 dark:text-red-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
            </svg>
            <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 truncate" title={docName}>
              {docName}
            </span>
            {isDirty && (
              <span className="shrink-0 text-[10px] sm:text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">
                Unsaved
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div aria-live="polite">
            {saveStatus?.kind === 'success' && (
              <div className="flex items-center gap-1 text-green-600 bg-green-50 dark:bg-green-900/20 px-2.5 py-1.5 rounded-md text-xs font-medium animate-fade-in">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="hidden sm:inline">{saveStatus.message === 'Saved' ? 'Saved!' : saveStatus.message}</span>
              </div>
            )}
            {saveStatus?.kind === 'error' && (
              <div
                className="flex items-center gap-1 text-red-600 bg-red-50 dark:bg-red-900/20 px-2.5 py-1.5 rounded-md text-xs font-medium animate-fade-in max-w-[10rem] sm:max-w-xs"
                title={saveStatus.message}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                {/* Visible on mobile too – the old version hid the error text below the sm breakpoint */}
                <span className="truncate">{saveStatus.message}</span>
              </div>
            )}
          </div>

          <button
            onClick={handleRefresh}
            disabled={isSyncing || isSaving}
            title="Refresh – pull the latest annotations & progress from your other devices"
            aria-label="Refresh and sync"
            className="flex items-center gap-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-60 px-2.5 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isSyncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Refresh'}</span>
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving || isSyncing}
            title="Save annotations now (they also save automatically) – Ctrl/⌘+S"
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors shadow-sm"
          >
            {isSaving ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                <span className="hidden sm:inline">Saving...</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                <span className="hidden sm:inline">Save</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Resume / progress banners */}
      {resumeState === 'resuming' && resumeTarget && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800 px-4 py-2 flex items-center justify-center gap-2 text-sm text-indigo-700 dark:text-indigo-300">
          Resuming from page {resumeTarget}
          {totalPages > 0 && <span className="text-indigo-500 dark:text-indigo-400">of {totalPages}</span>}
        </div>
      )}
      {resumeState === 'failed' && resumeTarget && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex flex-wrap items-center justify-center gap-3 text-sm text-amber-800 dark:text-amber-200">
          <span>Couldn't jump to your last page ({resumeTarget}). Progress saving is paused so it isn't overwritten.</span>
          <button onClick={() => retryResumeRef.current?.()} className="font-medium underline">
            Go to page {resumeTarget}
          </button>
          <button onClick={() => startTrackingRef.current?.()} className="font-medium underline">
            Start from here
          </button>
        </div>
      )}
      {remoteProgress && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800 px-4 py-2 flex flex-wrap items-center justify-center gap-3 text-sm text-indigo-700 dark:text-indigo-300">
          <span>Your other device is on page {remoteProgress}.</span>
          <button onClick={goToRemotePage} className="font-medium underline">Go to page {remoteProgress}</button>
          <button onClick={() => setRemoteProgress(null)} className="font-medium underline opacity-70">Dismiss</button>
        </div>
      )}
      {annotationsWarning && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-center text-sm text-amber-800 dark:text-amber-200">
          Couldn't load your saved annotations. Tap Refresh to try again – new annotations will still be saved.
        </div>
      )}
      {progressWarning && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-center text-sm text-amber-800 dark:text-amber-200">
          Couldn't load your saved progress, so progress saving is off for this session.
        </div>
      )}

      {/* PDF Viewer */}
      <div className="w-full flex-1 min-h-0">
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
            fontFallback: null, // PDFs embed their own fonts – no fallback fonts to host or download
            fonts: VIEWER_FONTS,
            stamp: { manifests: [] }, // don't fetch the default stamp library from a CDN
            theme: { preference: theme },
            annotations: { annotationAuthor: ANNOTATION_AUTHOR },
            disabledCategories: [
              'annotation-shape',
              'insert',
              'form',
              'redaction',
              'document-open',
              'document-close',
              'document-print',
              'document-export',
              'document-protect',
              'security',
            ],
          }}
          onReady={() => setViewerReady(true)}
        />
      </div>
    </div>
  );
}
