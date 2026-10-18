/**
 * Cloudflare Worker for the BAWS PDF Library (R2 + centralized metadata)
 *
 * R2 layout – folders are DISCOVERED, nothing is hard-coded:
 *   <any-folder>/  *.pdf, metadata.json (optional – reading progress, created automatically)
 *   _versions/<key>/<timestamp>.pdf     (rolling backups made before every overwrite)
 *   Annotation/<folder>/<name>.json     (one annotations file per PDF, created automatically on first save)
 *   _trash/<id>/                         (deleted documents, restorable for 30 days)
 *   _covers/<key>.jpg                    (cover image rendered from page 1)
 *   _library/state.json, reading.json    (favourites + tags, reading-time log)
 *
 * Every top-level folder that contains PDFs becomes a section in the library, headed by the folder name.
 * To add a new section just create a folder in the bucket and upload PDFs. No code change, no redeploy.
 * An optional "title" field in the folder's metadata.json overrides the heading.
 * Folders starting with "_" or "." are reserved/hidden (e.g. _versions), and so is "Annotation".
 *
 * Changes vs. the original:
 *  - metadata.json is updated with optimistic concurrency (etag + retry) -> no lost updates
 *  - a corrupt metadata.json is never silently replaced with an empty one
 *  - GET /api/documents is read-only (it used to WRITE metadata.json)
 *  - keys are validated (folder allow-list, .pdf only, no traversal); PUT validates the %PDF header
 *  - every overwrite keeps a backup (last MAX_VERSIONS)
 *  - ETag / If-None-Match / Range support on PDF download
 *  - numbers in metadata are validated and clamped
 *  - CORS origin is configurable via ALLOWED_ORIGIN
 */

export interface Env {
  PDF_BUCKET: R2Bucket;
  /** e.g. "https://library.abhirajbibhar.workers.dev". Defaults to "*" (open) if unset. */
  ALLOWED_ORIGIN?: string;
}

/** Per-document viewer state, saved together with reading progress. */
interface ViewState {
  /** A zoom factor (1 = 100%) or a mode that adapts to each screen. */
  zoom?: number | ZoomMode;
  scrollMode?: ScrollMode;
}

const ZOOM_MODES = ['automatic', 'fit-page', 'fit-width'] as const;
type ZoomMode = (typeof ZOOM_MODES)[number];
const SCROLL_MODES = ['vertical', 'horizontal'] as const;
type ScrollMode = (typeof SCROLL_MODES)[number];

interface MetadataEntry {
  lastPage: number;
  totalPages: number;
  lastOpened: string | null;
  readingTime?: number;
  view?: ViewState;
}

interface MetadataFile {
  version: string;
  lastUpdated: string;
  /** Optional heading for this folder in the library (defaults to the folder name). */
  title?: string;
  documents: Record<string, MetadataEntry>;
}

/** One annotation as stored in the sidecar. `data` is the viewer's own annotation object, kept verbatim. */
interface StoredAnnotation {
  id: string;
  page: number; // 1-based, for humans / search
  type: string;
  text: string; // selected text (highlights) – searchable
  note: string; // user's comment – searchable
  data: Record<string, unknown>;
  created: string;
  modified: string;
  deleted?: boolean; // tombstone: lets a deletion win over annotations still baked into an older PDF
}

interface AnnotationLogEntry {
  rev: number;
  op: 'upsert' | 'delete';
  id: string;
  at: string;
}

/** Annotation/<folder>/<name>.json */
interface AnnotationsFile {
  pdfId: string;
  version: 1;
  rev: number; // +1 on every successful PATCH
  lastUpdated: string;
  annotations: Record<string, StoredAnnotation>;
  log: AnnotationLogEntry[]; // capped history (basis for undo / restore later)
}

type AnnotationOp =
  | { op: 'delete'; id: string }
  | { op: 'upsert'; id: string; page: number; type: string; text: string; note: string; data: Record<string, unknown> };

const MAX_VERSIONS = 3;
const MAX_PDF_BYTES = 95 * 1024 * 1024; // Workers request-body limit is 100 MB on Free/Pro
const MAX_METADATA_RETRIES = 5;
const ANNOTATIONS_FOLDER = 'Annotation'; // reserved top-level folder for per-PDF annotation JSON

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- helpers

function buildCors(request: Request, env: Env): Record<string, string> {
  void request;
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, PUT, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range, If-None-Match, If-Match, X-Confirm-Delete',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, ETag, Content-Length',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data: unknown, cors: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Folders starting with "_" or ".", and the Annotation folder, are reserved: never shown as sections or writable as PDFs. */
function isHiddenFolder(name: string): boolean {
  return name.startsWith('_') || name.startsWith('.') || name.toLowerCase() === ANNOTATIONS_FOLDER.toLowerCase();
}

function folderOf(key: string): string {
  return key.split('/')[0];
}

/** Only allow "<folder>/<name>.pdf" – blocks writes to metadata.json, reserved folders, traversal, etc. */
function assertPdfKey(key: string): void {
  const parts = key.split('/');
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    isHiddenFolder(parts[0]) ||
    !/\.pdf$/i.test(key) ||
    key.includes('..') ||
    key.includes('\\')
  ) {
    throw new HttpError(400, 'Invalid document key');
  }
}

/** Accepts only well-formed view state; anything else is dropped (never trust client JSON). */
function sanitizeView(value: unknown): ViewState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const out: ViewState = {};
  if (typeof v.zoom === 'number' && Number.isFinite(v.zoom)) {
    out.zoom = Math.round(Math.min(10, Math.max(0.1, v.zoom)) * 100) / 100;
  } else if (typeof v.zoom === 'string' && (ZOOM_MODES as readonly string[]).includes(v.zoom)) {
    out.zoom = v.zoom as ZoomMode;
  }
  if (typeof v.scrollMode === 'string' && (SCROLL_MODES as readonly string[]).includes(v.scrollMode)) {
    out.scrollMode = v.scrollMode as ScrollMode;
  }
  return Object.keys(out).length ? out : undefined;
}

function decodeKey(path: string, base: string): string {
  try {
    return decodeURIComponent(path.slice(base.length));
  } catch {
    throw new HttpError(400, 'Malformed key');
  }
}

function toInt(value: unknown, fallback: number, min = 0, max = 1_000_000): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function toIso(value: unknown): string {
  const d = typeof value === 'string' ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

// ---------------------------------------------------------------- router

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = buildCors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const path = new URL(request.url).pathname;

    try {
      if (path === '/api/documents' && request.method === 'GET') {
        return await listDocuments(env, cors);
      }

      if (path === '/api/storage' && request.method === 'GET') {
        return await getStorage(env, cors);
      }

      if (path === '/api/annotations' && request.method === 'GET') {
        return await listAllAnnotations(env, cors);
      }

      if (path.startsWith('/api/metadata/') && path.length > '/api/metadata/'.length) {
        const key = decodeKey(path, '/api/metadata/');
        assertPdfKey(key);
        if (request.method === 'GET') return await getDocumentMetadata(key, env, cors);
        if (request.method === 'PUT') return await updateMetadata(key, request, env, cors);
      }

      if (path.startsWith('/api/documents/') && path.length > '/api/documents/'.length) {
        const key = decodeKey(path, '/api/documents/');
        assertPdfKey(key);
        if (request.method === 'GET' || request.method === 'HEAD') return await getDocument(key, request, env, cors);
        if (request.method === 'PUT') return await saveDocument(key, request, env, cors);
        if (request.method === 'DELETE') return await trashDocument(key, request, env, cors);
      }

      if (path === '/api/move' && request.method === 'POST') return await moveDocument(request, env, cors);

      if (path.startsWith('/api/state/') && request.method === 'PATCH') {
        const key = decodeKey(path, '/api/state/');
        assertPdfKey(key);
        return await patchDocState(key, request, env, cors);
      }

      if (path === '/api/quotes') {
        if (request.method === 'GET') return await getQuotes(env, cors);
        if (request.method === 'PUT') return await putQuotes(request, env, cors);
      }

      if (path === '/api/collections') {
        if (request.method === 'GET') return await getCollections(env, cors);
        if (request.method === 'PUT') return await putCollections(request, env, cors);
      }

      if (path === '/api/reading') {
        if (request.method === 'GET') return await getReading(env, cors);
        if (request.method === 'POST') return await logReading(request, env, cors);
      }
      if (path === '/api/reading/goal' && request.method === 'PUT') return await setReadingGoal(request, env, cors);

      if (path.startsWith('/api/covers/') && path.length > '/api/covers/'.length) {
        const key = decodeKey(path, '/api/covers/');
        assertPdfKey(key);
        if (request.method === 'GET') return await getCover(key, env, cors);
        if (request.method === 'PUT') return await putCover(key, request, env, cors);
      }

      if (path.startsWith('/api/versions/') && path.length > '/api/versions/'.length) {
        if (path.endsWith('/restore') && request.method === 'POST') {
          const key = decodeKey(path.slice(0, -'/restore'.length), '/api/versions/');
          assertPdfKey(key);
          return await restoreVersion(key, request, env, cors);
        }
        if (request.method === 'GET') {
          const key = decodeKey(path, '/api/versions/');
          assertPdfKey(key);
          return await listVersions(key, env, cors);
        }
      }

      if (path === '/api/trash') {
        if (request.method === 'GET') return await listTrash(env, cors);
        if (request.method === 'DELETE') {
          requireConfirm(request, 'empty-trash');
          const keys = (await listAll(env, `${TRASH_FOLDER}/`)).map((o) => o.key);
          await deleteKeys(env, keys);
          return json({ success: true, deleted: keys.length }, cors);
        }
      }
      if (path.startsWith('/api/trash/') && path.length > '/api/trash/'.length) {
        if (path.endsWith('/restore') && request.method === 'POST') {
          return await restoreFromTrash(decodeKey(path.slice(0, -'/restore'.length), '/api/trash/'), env, cors);
        }
        if (request.method === 'DELETE') {
          const id = decodeKey(path, '/api/trash/');
          if (!validTrashId(id)) throw new HttpError(400, 'Invalid trash id');
          requireConfirm(request, id);
          return json({ success: true, deleted: await purgeTrashItem(id, env) }, cors);
        }
      }

      // Annotations live in Annotation/<folder>/<name>.json, addressed by the PDF's key
      if (path.startsWith('/api/annotations/') && path.length > '/api/annotations/'.length) {
        const key = decodeKey(path, '/api/annotations/');
        assertPdfKey(key);
        if (request.method === 'GET') return await getAnnotations(key, env, cors);
        if (request.method === 'PATCH') return await patchAnnotations(key, request, env, cors);
      }

      return json({ error: 'Not Found' }, cors, 404);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, cors, err.status);
      console.error('Worker error:', err);
      return json({ error: 'Internal Server Error' }, cors, 500);
    }
  },
};


// ---------------------------------------------------------------- overview endpoints (home dashboard)

async function listAll(env: Env, prefix?: string): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.PDF_BUCKET.list({ prefix, cursor });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** GET /api/storage – bytes used in the bucket, per folder, plus backups and annotation files. */
async function getStorage(env: Env, cors: Record<string, string>): Promise<Response> {
  const objects = await listAll(env);
  const folders = new Map<string, { size: number; count: number }>();
  let total = 0;
  let backups = 0;
  let trash = 0;
  let annotations = 0;
  let other = 0;

  for (const o of objects) {
    total += o.size;
    const top = folderOf(o.key);
    if (!o.key.includes('/')) other += o.size;
    else if (top === '_versions') backups += o.size;
    else if (top === TRASH_FOLDER) trash += o.size;
    else if (top.toLowerCase() === ANNOTATIONS_FOLDER.toLowerCase()) annotations += o.size;
    else if (isHiddenFolder(top)) other += o.size;
    else {
      const f = folders.get(top) ?? { size: 0, count: 0 };
      f.size += o.size;
      if (/\.pdf$/i.test(o.key)) f.count += 1;
      folders.set(top, f);
    }
  }

  return json(
    {
      total,
      folders: [...folders.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.size - a.size),
      backups,
      trash,
      annotations,
      other,
    },
    cors,
  );
}

const MAX_ANNOTATION_FILES = 300;
const MAX_ANNOTATION_ITEMS = 2000;

/** GET /api/annotations – every live annotation across all PDFs, newest first (for the Annotations page). */
async function listAllAnnotations(env: Env, cors: Record<string, string>): Promise<Response> {
  const files = (await listAll(env, `${ANNOTATIONS_FOLDER}/`))
    .filter((o) => o.key.endsWith('.json'))
    .slice(0, MAX_ANNOTATION_FILES);

  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < files.length; i += 10) {
    await Promise.all(
      files.slice(i, i + 10).map(async (o) => {
        const obj = await env.PDF_BUCKET.get(o.key);
        if (!obj) return;
        try {
          const data = JSON.parse(await obj.text()) as AnnotationsFile;
          const docId =
            typeof data.pdfId === 'string' && data.pdfId
              ? data.pdfId
              : o.key.slice(ANNOTATIONS_FOLDER.length + 1).replace(/\.json$/i, '.pdf');
          for (const a of Object.values(data.annotations ?? {})) {
            if (!a || a.deleted) continue;
            const raw = (a.data as { color?: unknown } | undefined)?.color;
            items.push({
              docId,
              folder: folderOf(docId),
              docName: docId.split('/').pop()!.replace(/\.pdf$/i, ''),
              id: a.id,
              page: a.page,
              type: a.type,
              text: a.text,
              note: a.note,
              color: typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw : null,
              created: a.created,
              modified: a.modified,
            });
          }
        } catch {
          /* one unreadable file must not hide everyone else's annotations */
        }
      }),
    );
  }

  items.sort((a, b) => Date.parse(String(b.modified)) - Date.parse(String(a.modified)));
  return json({ total: items.length, items: items.slice(0, MAX_ANNOTATION_ITEMS) }, cors);
}


// ---------------------------------------------------------------- library extras (trash, move, tags, reading, covers, versions)

const TRASH_FOLDER = '_trash';
const COVERS_FOLDER = '_covers';
const LIBRARY_FOLDER = '_library';
const STATE_KEY = `${LIBRARY_FOLDER}/state.json`;
const READING_KEY = `${LIBRARY_FOLDER}/reading.json`;
const COLLECTIONS_KEY = `${LIBRARY_FOLDER}/collections.json`;
const QUOTES_KEY = `${LIBRARY_FOLDER}/quotes.json`;
const TRASH_DAYS = 30;
const MAX_COVER_BYTES = 400 * 1024;
const MAX_TAGS = 12;

/** Optional book details the person can fill in (shown on the book page). */
interface DocMeta {
  author?: string;
  description?: string;
  publishedYear?: number;
  language?: string;
  isbn?: string;
  rating?: number; // 1-5
}
interface DocState {
  favorite?: boolean;
  tags?: string[];
  meta?: DocMeta;
}
interface CollectionRecord {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  bookIds: string[]; // pdf keys
  createdAt: string;
}
/** A quote the person picked (from an annotation or typed in) with its attribution. */
interface QuoteRecord {
  id: string;
  text: string;
  author: string;
  book: string;
  year: number | null;
  page: number | null;
  note: string; // optional context, e.g. the chapter or why it matters
  bookKey: string; // pdf key it came from ('' if typed in)
  addedAt: string;
}
interface QuotesFile {
  version: 1;
  quotes: QuoteRecord[];
}
interface CollectionsFile {
  version: 1;
  collections: CollectionRecord[];
}
interface StateFile {
  version: 1;
  docs: Record<string, DocState>;
}
interface ReadingFile {
  version: 1;
  days: Record<string, number>; // "YYYY-MM-DD" (the reader's local day) -> seconds
  docs: Record<string, number>; // pdf key -> seconds
  dayDocs?: Record<string, Record<string, number>>; // day -> pdf key -> seconds (last ~4 months)
  goalMinutes?: number;
}
interface TrashItem {
  id: string;
  key: string;
  name: string;
  folder: string;
  size: number;
  deletedAt: string;
  progress: MetadataEntry | null;
  state: DocState | null;
  objects: string[]; // original keys of everything that was moved (PDF, annotations, cover, backups)
}

const emptyState = (): StateFile => ({ version: 1, docs: {} });
const emptyReading = (): ReadingFile => ({ version: 1, days: {}, docs: {}, dayDocs: {} });
const emptyQuotes = (): QuotesFile => ({ version: 1, quotes: [] });
const emptyCollections = (): CollectionsFile => ({ version: 1, collections: [] });
const coverKey = (key: string) => `${COVERS_FOLDER}/${key}.jpg`;

/** A DELETE only goes through when the caller names exactly what it wants gone (guards against stray requests). */
function requireConfirm(request: Request, expected: string): void {
  let got = request.headers.get('X-Confirm-Delete') ?? '';
  try {
    got = decodeURIComponent(got);
  } catch {
    /* keep raw */
  }
  if (got !== expected) throw new HttpError(400, 'Delete not confirmed');
}

async function deleteKeys(env: Env, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) await env.PDF_BUCKET.delete(keys.slice(i, i + 1000));
}

/** R2 has no rename: copy then delete. Streams the body, so large PDFs are never buffered. */
async function moveObject(env: Env, from: string, to: string): Promise<boolean> {
  const obj = await env.PDF_BUCKET.get(from);
  if (!obj) return false;
  await env.PDF_BUCKET.put(to, obj.body, { httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata });
  await env.PDF_BUCKET.delete(from);
  return true;
}

/** Small JSON files in _library/ with optimistic concurrency, like metadata.json. */
async function readJsonFile<T extends object>(
  key: string,
  env: Env,
  empty: () => T,
): Promise<{ data: T; etag: string | null }> {
  const obj = await env.PDF_BUCKET.get(key);
  if (!obj) return { data: empty(), etag: null };
  try {
    const parsed = JSON.parse(await obj.text());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad shape');
    return { data: { ...empty(), ...parsed } as T, etag: obj.etag };
  } catch {
    throw new HttpError(500, `${key} is corrupt; refusing to overwrite`);
  }
}

async function mutateJsonFile<T extends object>(key: string, env: Env, empty: () => T, mutate: (d: T) => void): Promise<T> {
  for (let attempt = 0; attempt < MAX_METADATA_RETRIES; attempt++) {
    const { data, etag } = await readJsonFile(key, env, empty);
    mutate(data);
    const result = await env.PDF_BUCKET.put(key, JSON.stringify(data), {
      httpMetadata: { contentType: 'application/json' },
      onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
    });
    if (result) return data;
  }
  throw new HttpError(409, 'Busy, please retry');
}

// ---- favourites and tags

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const tag = raw.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
    const k = tag.toLowerCase();
    if (!tag || seen.has(k)) continue;
    seen.add(k);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

const clipStr = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');

function sanitizeMeta(value: unknown): DocMeta {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const out: DocMeta = {};
  const author = clipStr(v.author, 120);
  const description = clipStr(v.description, 2000);
  const language = clipStr(v.language, 40);
  const isbn = clipStr(v.isbn, 30);
  if (author) out.author = author;
  if (description) out.description = description;
  if (language) out.language = language;
  if (isbn) out.isbn = isbn;
  const year = toInt(v.publishedYear, 0, 0, 3000);
  if (year) out.publishedYear = year;
  const rating = toInt(v.rating, 0, 0, 5);
  if (rating) out.rating = rating;
  return out;
}

async function patchDocState(key: string, request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { favorite?: unknown; tags?: unknown; meta?: unknown } | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid JSON body');
  if (!(await env.PDF_BUCKET.head(key))) throw new HttpError(404, 'PDF not found');

  let result: DocState = {};
  await mutateJsonFile(STATE_KEY, env, emptyState, (st) => {
    const cur: DocState = { ...(st.docs[key] ?? {}) };
    if (typeof body.favorite === 'boolean') cur.favorite = body.favorite;
    if (body.tags !== undefined) cur.tags = sanitizeTags(body.tags);
    if (body.meta !== undefined) cur.meta = sanitizeMeta(body.meta);
    const clean: DocState = {};
    if (cur.favorite) clean.favorite = true;
    if (cur.tags && cur.tags.length) clean.tags = cur.tags;
    if (cur.meta && Object.keys(cur.meta).length) clean.meta = cur.meta;
    if (Object.keys(clean).length) st.docs[key] = clean;
    else delete st.docs[key];
    result = clean;
  });
  return json({ success: true, favorite: !!result.favorite, tags: result.tags ?? [], meta: result.meta ?? {} }, cors);
}

// ---- reading time

async function logReading(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { key?: unknown; seconds?: unknown; day?: unknown } | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid JSON body');
  const seconds = toInt(body.seconds, 0, 0, 300);
  const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null;
  if (!seconds || !day) throw new HttpError(400, 'Invalid reading entry');
  const t = Date.parse(`${day}T12:00:00Z`);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > 3 * 86_400_000) throw new HttpError(400, 'Invalid day');
  const key = typeof body.key === 'string' ? body.key : null;
  if (key) assertPdfKey(key);

  await mutateJsonFile(READING_KEY, env, emptyReading, (r) => {
    r.days[day] = (r.days[day] ?? 0) + seconds;
    if (key) {
      r.docs[key] = (r.docs[key] ?? 0) + seconds;
      r.dayDocs ??= {};
      r.dayDocs[day] = { ...(r.dayDocs[day] ?? {}), [key]: (r.dayDocs[day]?.[key] ?? 0) + seconds };
    }
    const cutoff = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    for (const d of Object.keys(r.days)) if (d < cutoff) delete r.days[d];
    const docCutoff = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    for (const d of Object.keys(r.dayDocs ?? {})) if (d < docCutoff) delete r.dayDocs![d];
  });
  return json({ success: true }, cors);
}

async function getReading(env: Env, cors: Record<string, string>): Promise<Response> {
  const { data } = await readJsonFile(READING_KEY, env, emptyReading);
  return json({ days: data.days, dayDocs: data.dayDocs ?? {}, goalMinutes: data.goalMinutes ?? 0 }, cors);
}

async function setReadingGoal(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { goalMinutes?: unknown } | null;
  const goal = toInt(body?.goalMinutes, 0, 0, 600);
  await mutateJsonFile(READING_KEY, env, emptyReading, (r) => {
    r.goalMinutes = goal;
  });
  return json({ success: true, goalMinutes: goal }, cors);
}

// ---- collections (user-made groups of books, independent of folders)

const validBookKey = (k: unknown): k is string =>
  typeof k === 'string' && k.length <= 300 && k.includes('/') && !k.includes('..') && !k.includes('\\') && /\.pdf$/i.test(k) && !isHiddenFolder(k.split('/')[0]);

function sanitizeCollections(value: unknown): CollectionRecord[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'collections must be an array');
  const seen = new Set<string>();
  const out: CollectionRecord[] = [];
  for (const raw of value.slice(0, 200)) {
    const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = clipStr(c.id, 60);
    const name = clipStr(c.name, 60);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const ids = Array.isArray(c.bookIds) ? [...new Set(c.bookIds.filter(validBookKey))].slice(0, 2000) : [];
    out.push({
      id,
      name,
      description: clipStr(c.description, 300),
      icon: clipStr(c.icon, 8),
      color: clipStr(c.color, 40),
      bookIds: ids,
      createdAt: toIso(c.createdAt),
    });
  }
  return out;
}

async function getCollections(env: Env, cors: Record<string, string>): Promise<Response> {
  const { data } = await readJsonFile(COLLECTIONS_KEY, env, emptyCollections);
  return json({ collections: data.collections }, cors);
}

async function putCollections(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { collections?: unknown } | null;
  const collections = sanitizeCollections(body?.collections);
  await mutateJsonFile(COLLECTIONS_KEY, env, emptyCollections, (f) => {
    f.collections = collections;
  });
  return json({ success: true, collections }, cors);
}

// ---- quotes (a plain JSON file of passages you chose, with attribution)

function sanitizeQuotes(value: unknown): QuoteRecord[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'quotes must be an array');
  const seen = new Set<string>();
  const out: QuoteRecord[] = [];
  for (const raw of value.slice(0, 3000)) {
    const q = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = clipStr(q.id, 60);
    const text = clipStr(q.text, 3000);
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    const year = toInt(q.year, 0, 0, 3000);
    const page = toInt(q.page, 0, 0, 100000);
    const bookKey = typeof q.bookKey === 'string' && validBookKey(q.bookKey) ? q.bookKey : '';
    out.push({
      id,
      text,
      author: clipStr(q.author, 120),
      book: clipStr(q.book, 200),
      year: year || null,
      page: page || null,
      note: clipStr(q.note, 500),
      bookKey,
      addedAt: toIso(q.addedAt),
    });
  }
  return out;
}

async function getQuotes(env: Env, cors: Record<string, string>): Promise<Response> {
  const { data } = await readJsonFile(QUOTES_KEY, env, emptyQuotes);
  return json({ quotes: data.quotes }, cors);
}

async function putQuotes(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { quotes?: unknown } | null;
  const quotes = sanitizeQuotes(body?.quotes);
  await mutateJsonFile(QUOTES_KEY, env, emptyQuotes, (f) => {
    f.quotes = quotes;
  });
  return json({ success: true, quotes }, cors);
}

// ---- covers

function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

async function putCover(key: string, request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_COVER_BYTES) throw new HttpError(413, 'Cover image is too large');
  const type = sniffImage(new Uint8Array(body.slice(0, 12)));
  if (!type) throw new HttpError(400, 'Cover must be a JPEG, PNG or WebP image');
  if (!(await env.PDF_BUCKET.head(key))) throw new HttpError(404, 'PDF not found');
  await env.PDF_BUCKET.put(coverKey(key), body, { httpMetadata: { contentType: type } });
  return json({ success: true }, cors);
}

async function getCover(key: string, env: Env, cors: Record<string, string>): Promise<Response> {
  const obj = await env.PDF_BUCKET.get(coverKey(key));
  if (!obj) return json({ error: 'No cover' }, cors, 404);
  const headers = new Headers(cors);
  obj.writeHttpMetadata(headers);
  // The URL carries ?v=<upload time>, so a new cover is a new URL and this can be cached hard (private: it is behind login).
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}

// ---- trash

/** Everything that belongs to one document (original keys): PDF, annotations, cover, backups. */
async function documentObjectKeys(key: string, env: Env): Promise<string[]> {
  const keys = [key];
  for (const k of [annotationsKey(key), coverKey(key)]) if (await env.PDF_BUCKET.head(k)) keys.push(k);
  keys.push(...(await listAll(env, `_versions/${key}/`)).map((o) => o.key));
  return keys;
}

/** After a document left its folder: drop its progress / state entries (and metadata.json if the folder is now empty). */
async function forgetDocument(key: string, env: Env): Promise<void> {
  const folder = folderOf(key);
  const remaining = (await listFolder(folder, env)).filter((o) => /\.pdf$/i.test(o.key));
  if (remaining.length === 0) await env.PDF_BUCKET.delete(`${folder}/metadata.json`);
  else await mutateMetadata(folder, env, (m) => { delete m.documents[key]; });
  await mutateJsonFile(STATE_KEY, env, emptyState, (st) => { delete st.docs[key]; }).catch((e) => console.error('state cleanup failed', e));
}

const validTrashId = (id: string) => /^[a-z0-9]{6,40}$/i.test(id);

/** "Delete" in the app: moves the document (with its annotations, cover and backups) to the trash for 30 days. */
async function trashDocument(key: string, request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  requireConfirm(request, key);
  const head = await env.PDF_BUCKET.head(key);
  if (!head) throw new HttpError(404, 'PDF not found');

  const folder = folderOf(key);
  const id = `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, '').slice(0, 6)}`;
  const base = `${TRASH_FOLDER}/${id}`;
  const keys = await documentObjectKeys(key, env);
  const [meta, st] = await Promise.all([
    readMetadata(folder, env).catch(() => ({ data: emptyMetadata(), etag: null })),
    readJsonFile(STATE_KEY, env, emptyState).catch(() => ({ data: emptyState(), etag: null })),
  ]);
  const item: TrashItem = {
    id,
    key,
    name: key.split('/').pop()!.replace(/\.pdf$/i, ''),
    folder,
    size: head.size,
    deletedAt: new Date().toISOString(),
    progress: meta.data.documents[key] ?? null,
    state: st.data.docs[key] ?? null,
    objects: keys,
  };
  // Write the manifest first: if anything below fails half-way, the files can still be found and restored.
  await env.PDF_BUCKET.put(`${base}/item.json`, JSON.stringify(item), { httpMetadata: { contentType: 'application/json' } });
  for (const k of keys) await moveObject(env, k, `${base}/files/${k}`);
  await forgetDocument(key, env);
  return json({ success: true, id }, cors);
}

async function purgeExpiredTrash(items: TrashItem[], env: Env): Promise<TrashItem[]> {
  const cutoff = Date.now() - TRASH_DAYS * 86_400_000;
  const keep: TrashItem[] = [];
  for (const it of items) {
    if (Date.parse(it.deletedAt) < cutoff) await purgeTrashItem(it.id, env);
    else keep.push(it);
  }
  return keep;
}

async function purgeTrashItem(id: string, env: Env): Promise<number> {
  const keys = (await listAll(env, `${TRASH_FOLDER}/${id}/`)).map((o) => o.key);
  await deleteKeys(env, keys);
  return keys.length;
}

async function listTrash(env: Env, cors: Record<string, string>): Promise<Response> {
  const manifests = (await listAll(env, `${TRASH_FOLDER}/`)).filter((o) => o.key.endsWith('/item.json')).slice(0, 500);
  const loaded = await Promise.all(
    manifests.map(async (o) => {
      try {
        const obj = await env.PDF_BUCKET.get(o.key);
        return obj ? (JSON.parse(await obj.text()) as TrashItem) : null;
      } catch {
        return null;
      }
    }),
  );
  const items = await purgeExpiredTrash(loaded.filter((x): x is TrashItem => !!x && validTrashId(x.id)), env);
  items.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
  return json(
    items.map((it) => ({
      id: it.id,
      key: it.key,
      name: it.name,
      folder: it.folder,
      size: it.size,
      deletedAt: it.deletedAt,
      expiresAt: new Date(Date.parse(it.deletedAt) + TRASH_DAYS * 86_400_000).toISOString(),
    })),
    cors,
  );
}

const allowedRestoreKey = (rel: string, item: TrashItem) =>
  rel === item.key ||
  ((rel.startsWith(`${ANNOTATIONS_FOLDER}/`) || rel.startsWith(`${COVERS_FOLDER}/`) || rel.startsWith('_versions/')) && !rel.includes('..'));

async function restoreFromTrash(id: string, env: Env, cors: Record<string, string>): Promise<Response> {
  if (!validTrashId(id)) throw new HttpError(400, 'Invalid trash id');
  const base = `${TRASH_FOLDER}/${id}`;
  const manifest = await env.PDF_BUCKET.get(`${base}/item.json`);
  if (!manifest) throw new HttpError(404, 'Not in the trash');
  const item = JSON.parse(await manifest.text()) as TrashItem;
  assertPdfKey(item.key);
  if (await env.PDF_BUCKET.head(item.key)) {
    throw new HttpError(409, `A document named “${item.name}” already exists in ${item.folder}. Rename or delete it first.`);
  }

  for (const rel of item.objects) {
    if (!allowedRestoreKey(rel, item)) continue;
    await moveObject(env, `${base}/files/${rel}`, rel);
  }
  if (item.progress) {
    await mutateMetadata(item.folder, env, (m) => {
      m.documents[item.key] = item.progress as MetadataEntry;
    });
  }
  if (item.state) {
    await mutateJsonFile(STATE_KEY, env, emptyState, (st) => {
      st.docs[item.key] = item.state as DocState;
    });
  }
  await purgeTrashItem(id, env);
  return json({ success: true, key: item.key }, cors);
}

// ---- move / rename

async function moveDocument(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { from?: unknown; to?: unknown } | null;
  if (!body || typeof body.from !== 'string' || typeof body.to !== 'string') throw new HttpError(400, 'from and to are required');
  const { from, to } = body;
  assertPdfKey(from);
  assertPdfKey(to);
  if (from === to) throw new HttpError(400, 'Nothing to change');
  if (to.length > 300) throw new HttpError(400, 'Name is too long');
  if (!(await env.PDF_BUCKET.head(from))) throw new HttpError(404, 'PDF not found');
  if (await env.PDF_BUCKET.head(to)) throw new HttpError(409, 'A document with that name already exists there');

  const srcFolder = folderOf(from);
  const dstFolder = folderOf(to);
  const progress = (await readMetadata(srcFolder, env).catch(() => ({ data: emptyMetadata(), etag: null }))).data.documents[from];

  // Biggest (and likeliest to fail) first, so a failure leaves everything else untouched.
  await moveObject(env, from, to);

  const side = await env.PDF_BUCKET.get(annotationsKey(from));
  if (side) {
    const text = await side.text();
    let out = text;
    try {
      const parsed = JSON.parse(text) as AnnotationsFile;
      parsed.pdfId = to;
      out = JSON.stringify(parsed);
    } catch {
      /* move it untouched */
    }
    await env.PDF_BUCKET.put(annotationsKey(to), out, { httpMetadata: { contentType: 'application/json' } });
    await env.PDF_BUCKET.delete(annotationsKey(from));
  }
  await moveObject(env, coverKey(from), coverKey(to));
  for (const v of await listAll(env, `_versions/${from}/`)) {
    await moveObject(env, v.key, `_versions/${to}/${v.key.split('/').pop()}`);
  }

  if (srcFolder === dstFolder) {
    await mutateMetadata(srcFolder, env, (m) => {
      if (m.documents[from]) m.documents[to] = m.documents[from];
      delete m.documents[from];
    });
  } else {
    if (progress) {
      await mutateMetadata(dstFolder, env, (m) => {
        m.documents[to] = progress;
      });
    }
    await forgetDocument(from, env);
  }

  await mutateJsonFile(STATE_KEY, env, emptyState, (st) => {
    if (st.docs[from]) st.docs[to] = st.docs[from];
    delete st.docs[from];
  }).catch((e) => console.error('state move failed', e));
  await mutateJsonFile(QUOTES_KEY, env, emptyQuotes, (f) => {
    for (const q of f.quotes) if (q.bookKey === from) q.bookKey = to;
  }).catch((e) => console.error('quotes move failed', e));
  await mutateJsonFile(COLLECTIONS_KEY, env, emptyCollections, (f) => {
    for (const c of f.collections) c.bookIds = c.bookIds.map((k) => (k === from ? to : k));
  }).catch((e) => console.error('collections move failed', e));
  await mutateJsonFile(READING_KEY, env, emptyReading, (r) => {
    if (r.docs[from] !== undefined) r.docs[to] = r.docs[from];
    delete r.docs[from];
  }).catch((e) => console.error('reading move failed', e));

  return json({ success: true, key: to }, cors);
}

// ---- version history

async function listVersions(key: string, env: Env, cors: Record<string, string>): Promise<Response> {
  const objs = await listAll(env, `_versions/${key}/`);
  const items = objs
    .map((o) => ({ id: o.key.split('/').pop()!.replace(/\.pdf$/i, ''), size: o.size, uploaded: o.uploaded.toISOString() }))
    .sort((a, b) => (a.id < b.id ? 1 : -1));
  return json(items, cors);
}

async function restoreVersion(key: string, request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === 'string' && /^[0-9TZ-]+$/.test(body.id) ? body.id : null;
  if (!id) throw new HttpError(400, 'Invalid version id');
  const version = await env.PDF_BUCKET.get(`_versions/${key}/${id}.pdf`);
  if (!version) throw new HttpError(404, 'Version not found');

  await backupExisting(key, env, false); // keep what is current as a new backup before swapping
  await env.PDF_BUCKET.put(key, version.body, { httpMetadata: { contentType: 'application/pdf' } });
  await pruneVersions(key, env);
  return json({ success: true }, cors);
}

// ---------------------------------------------------------------- metadata (optimistic concurrency)

function emptyMetadata(): MetadataFile {
  return { version: '1.0', lastUpdated: new Date().toISOString(), documents: {} };
}

/** Read-only. Returns the parsed file and its etag (null etag = file doesn't exist yet). */
async function readMetadata(
  folder: string,
  env: Env,
): Promise<{ data: MetadataFile; etag: string | null }> {
  const obj = await env.PDF_BUCKET.get(`${folder}/metadata.json`);
  if (!obj) return { data: emptyMetadata(), etag: null };

  const text = await obj.text();
  try {
    const parsed = JSON.parse(text) as Partial<MetadataFile> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad shape');
    // A hand-written metadata.json may omit fields – fill them in rather than failing the whole folder.
    const data: MetadataFile = {
      ...parsed,
      version: parsed.version ?? '1.0',
      lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
      documents: parsed.documents && typeof parsed.documents === 'object' ? parsed.documents : {},
    };
    return { data, etag: obj.etag };
  } catch {
    // Never overwrite a file we can't parse – that would wipe everyone's progress.
    throw new HttpError(500, `metadata.json in ${folder} is corrupt; refusing to overwrite`);
  }
}

/** Read-modify-write that retries if someone else wrote in between. */
async function mutateMetadata(
  folder: string,
  env: Env,
  mutate: (m: MetadataFile) => void,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_METADATA_RETRIES; attempt++) {
    const { data, etag } = await readMetadata(folder, env);
    mutate(data);
    data.lastUpdated = new Date().toISOString();

    const result = await env.PDF_BUCKET.put(`${folder}/metadata.json`, JSON.stringify(data, null, 2), {
      httpMetadata: { contentType: 'application/json' },
      // null result => precondition failed => retry with fresh data
      onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
    });
    if (result) return;
  }
  throw new HttpError(409, 'Metadata is busy, please retry');
}

// ---------------------------------------------------------------- handlers

async function listFolder(prefix: string, env: Env): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.PDF_BUCKET.list({ prefix: `${prefix}/`, cursor });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** Top-level "folders" in the bucket (R2 has no real folders – we ask for the common prefixes). */
async function listFolders(env: Env): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.PDF_BUCKET.list({ delimiter: '/', cursor });
    for (const prefix of page.delimitedPrefixes) {
      const name = prefix.replace(/\/$/, '');
      if (name && !isHiddenFolder(name)) out.push(name);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function listDocuments(env: Env, cors: Record<string, string>): Promise<Response> {
  const [folders, st, reading, covers] = await Promise.all([
    listFolders(env),
    // These extras must never stop the library from loading.
    readJsonFile(STATE_KEY, env, emptyState).catch(() => ({ data: emptyState(), etag: null })),
    readJsonFile(READING_KEY, env, emptyReading).catch(() => ({ data: emptyReading(), etag: null })),
    listAll(env, `${COVERS_FOLDER}/`).catch(() => [] as R2Object[]),
  ]);
  const coverMap = new Map(covers.map((c) => [c.key.slice(COVERS_FOLDER.length + 1).replace(/\.jpg$/i, ''), c.uploaded.getTime()]));

  const perFolder = await Promise.all(
    folders.map(async (folder) => {
      const [meta, objects] = await Promise.all([
        // A broken metadata.json must not hide the folder's PDFs: read-only fallback to "no progress".
        readMetadata(folder, env).catch((err) => {
          console.error(`Could not read metadata for ${folder}:`, err);
          return { data: emptyMetadata(), etag: null };
        }),
        listFolder(folder, env),
      ]);
      const { data } = meta;
      const folderTitle = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : folder;

      return objects
        .filter((o) => /\.pdf$/i.test(o.key) && o.key.split('/').length === 2)
        .map((o) => {
          const entry = data.documents[o.key];
          return {
            id: o.key,
            name: o.key.split('/').pop()!.replace(/\.pdf$/i, ''),
            folder,
            folderTitle,
            size: o.size,
            lastModified: o.uploaded.toISOString(),
            lastPage: entry?.lastPage ?? 1,
            totalPages: entry?.totalPages ?? 0,
            // null = never opened (previously this was faked with the upload date)
            lastOpened: entry?.lastOpened ?? null,
            readingTime: reading.data.docs[o.key] ?? entry?.readingTime ?? 0,
            view: sanitizeView(entry?.view) ?? null,
            favorite: !!st.data.docs[o.key]?.favorite,
            tags: st.data.docs[o.key]?.tags ?? [],
            meta: st.data.docs[o.key]?.meta ?? {},
            cover: coverMap.get(o.key) ?? null,
          };
        });
    }),
  );

  const docs = perFolder.flat();
  docs.sort((a, b) => (b.lastOpened ? Date.parse(b.lastOpened) : 0) - (a.lastOpened ? Date.parse(a.lastOpened) : 0));
  return json(docs, cors);
}

async function getDocumentMetadata(key: string, env: Env, cors: Record<string, string>): Promise<Response> {
  const { data } = await readMetadata(folderOf(key), env);
  const meta = data.documents[key] ?? { lastPage: 1, totalPages: 0, lastOpened: null, readingTime: 0 };
  return json({ ...meta, view: sanitizeView(meta.view) ?? null }, cors);
}

async function updateMetadata(
  key: string,
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Partial<MetadataEntry> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid JSON body');

  const folder = folderOf(key);
  const totalPages = toInt(body.totalPages, 0);
  const view = sanitizeView(body.view);
  let lastPage = toInt(body.lastPage, 1, 1);
  if (totalPages > 0) lastPage = Math.min(lastPage, totalPages);

  await mutateMetadata(folder, env, (m) => {
    const prev = m.documents[key];
    const keepView = view ?? sanitizeView(prev?.view);
    m.documents[key] = {
      lastPage,
      totalPages: totalPages || prev?.totalPages || 0,
      lastOpened: toIso(body.lastOpened),
      readingTime: body.readingTime !== undefined ? toInt(body.readingTime, 0) : prev?.readingTime ?? 0,
      // Progress-only updates (no view in the body) must not wipe the saved zoom / scroll mode.
      ...(keepView ? { view: keepView } : {}),
    };
  });

  return json({ success: true }, cors);
}

function parseRange(object: R2Object): { start: number; end: number } | null {
  const r = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (!r) return null;
  if (r.suffix !== undefined) {
    const length = Math.min(r.suffix, object.size);
    return { start: object.size - length, end: object.size - 1 };
  }
  const start = r.offset ?? 0;
  const length = r.length ?? object.size - start;
  return { start, end: start + length - 1 };
}

async function getDocument(
  key: string,
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const object = await env.PDF_BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
  if (!object) return json({ error: 'PDF not found' }, cors, 404);

  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', 'application/pdf');
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, no-cache'); // always revalidate; 304 keeps it cheap

  // No body => a precondition failed. If-Match (sent on every streamed range request) => the PDF changed
  // mid-read: 412. If-None-Match => "unchanged": 304.
  if (!('body' in object) || !object.body) {
    return new Response(null, { status: request.headers.has('If-Match') ? 412 : 304, headers });
  }

  const isHead = request.method === 'HEAD';

  // Only answer 206 if the client actually asked for a range (R2 may report a full-object range otherwise)
  const range = request.headers.has('Range') ? parseRange(object) : null;
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${object.size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(isHead ? null : object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(isHead ? null : object.body, { headers });
}

async function saveDocument(
  key: string,
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > MAX_PDF_BYTES) throw new HttpError(413, 'PDF too large');

  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_PDF_BYTES) throw new HttpError(413, 'Invalid PDF size');

  // Sanity check: a PDF starts with "%PDF" (allow a little leading junk like the spec does)
  const head = new TextDecoder('latin1').decode(body.slice(0, 1024));
  if (!head.includes('%PDF-')) throw new HttpError(400, 'Body is not a PDF');

  // Optimistic concurrency: if the client says which version it started from (If-Match) and someone
  // else has saved since, refuse with 412 instead of silently overwriting their annotations.
  const ifMatch = request.headers.get('If-Match')?.replace(/^W\//, '').replace(/"/g, '');
  const current = ifMatch ? await env.PDF_BUCKET.head(key) : null;
  if (ifMatch && ifMatch !== '*' && current && current.etag !== ifMatch) {
    throw new HttpError(412, 'Changed on another device');
  }

  await backupExisting(key, env);

  const saved = await env.PDF_BUCKET.put(key, body, {
    httpMetadata: { contentType: 'application/pdf' },
    // Atomic re-check at write time (closes the gap between head() and put()).
    ...(current ? { onlyIf: { etagMatches: current.etag } } : {}),
  });
  if (!saved) throw new HttpError(412, 'Changed on another device');
  return json({ success: true, size: body.byteLength, etag: saved.httpEtag }, cors);
}

/** Copy the current object to _versions/<key>/<timestamp>.pdf and (optionally) prune old copies. */
async function backupExisting(key: string, env: Env, prune = true): Promise<void> {
  const existing = await env.PDF_BUCKET.get(key);
  if (!existing) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await env.PDF_BUCKET.put(`_versions/${key}/${stamp}.pdf`, existing.body, {
    httpMetadata: { contentType: 'application/pdf' },
  });
  if (prune) await pruneVersions(key, env);
}

async function pruneVersions(key: string, env: Env): Promise<void> {
  const versions = await env.PDF_BUCKET.list({ prefix: `_versions/${key}/` });
  const stale = versions.objects
    .map((o) => o.key)
    .sort() // ISO-ish timestamps sort chronologically
    .slice(0, Math.max(0, versions.objects.length - MAX_VERSIONS));
  if (stale.length) await env.PDF_BUCKET.delete(stale);
}

// ---------------------------------------------------------------- annotations sidecar
//
// One JSON file per PDF:   Speeches/Vol-01.pdf  ->  Annotation/Speeches/Vol-01.json
//
// R2 has no real folders – "Annotation/Speeches/" exists as soon as the first object with that prefix is
// written, so the worker creates the whole structure itself on the first save. Nothing to set up by hand.
//
// The PDF is never rewritten. Clients send small per-annotation operations (PATCH); the worker merges them
// by annotation id with optimistic concurrency, so two devices editing different annotations never clash.

const MAX_ANNOTATION_OPS = 500;
const MAX_ANNOTATION_BODY = 4 * 1024 * 1024;
const MAX_ANNOTATION_DATA = 512 * 1024; // one annotation
const MAX_ANNOTATIONS_FILE = 8 * 1024 * 1024;
const MAX_ANNOTATION_LOG = 500;
const MAX_ANNOTATION_RETRIES = 8;
const MAX_ANNOTATION_TEXT = 5000;

const annotationsKey = (key: string) => `${ANNOTATIONS_FOLDER}/${key.replace(/\.pdf$/i, '')}.json`;

function emptyAnnotations(key: string): AnnotationsFile {
  return { pdfId: key, version: 1, rev: 0, lastUpdated: new Date().toISOString(), annotations: {}, log: [] };
}

async function readAnnotations(key: string, env: Env): Promise<{ data: AnnotationsFile; etag: string | null }> {
  const obj = await env.PDF_BUCKET.get(annotationsKey(key));
  if (!obj) return { data: emptyAnnotations(key), etag: null };
  try {
    const data = JSON.parse(await obj.text()) as AnnotationsFile;
    if (!data || typeof data.annotations !== 'object' || Array.isArray(data.annotations)) throw new Error('bad shape');
    if (!Array.isArray(data.log)) data.log = [];
    return { data, etag: obj.etag };
  } catch {
    // Never overwrite a file we cannot read – that could destroy a user's annotations.
    throw new HttpError(500, 'Annotations file is corrupt – restore it manually');
  }
}

async function getAnnotations(key: string, env: Env, cors: Record<string, string>): Promise<Response> {
  const { data, etag } = await readAnnotations(key, env);
  const headers: Record<string, string> = { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (etag) headers.ETag = `"${etag}"`;
  return new Response(JSON.stringify(data), { headers });
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Validates the client's operations – never trust client JSON. */
function sanitizeOps(body: unknown): AnnotationOp[] {
  const raw = (body as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'Expected { ops: [...] }');
  if (raw.length > MAX_ANNOTATION_OPS) throw new HttpError(413, `At most ${MAX_ANNOTATION_OPS} operations per request`);

  return raw.map((item): AnnotationOp => {
    const o = (item ?? {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    if (!/^[^\s"\\/]{1,128}$/.test(id)) throw new HttpError(400, 'Invalid annotation id');

    if (o.op === 'delete') return { op: 'delete', id };

    if (o.op === 'upsert') {
      const data = o.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Annotation data missing');
      if (JSON.stringify(data).length > MAX_ANNOTATION_DATA) throw new HttpError(413, 'Annotation too large');
      return {
        op: 'upsert',
        id,
        page: toInt(o.page, 1, 1, 100_000),
        type: clip(o.type, 40),
        text: clip(o.text, MAX_ANNOTATION_TEXT),
        note: clip(o.note, MAX_ANNOTATION_TEXT),
        data: data as Record<string, unknown>,
      };
    }
    throw new HttpError(400, 'Unknown operation');
  });
}

function applyAnnotationOps(file: AnnotationsFile, ops: AnnotationOp[]): void {
  const now = new Date().toISOString();
  file.rev += 1;
  file.lastUpdated = now;

  for (const op of ops) {
    const existing = file.annotations[op.id];
    if (op.op === 'upsert') {
      file.annotations[op.id] = {
        id: op.id,
        page: op.page,
        type: op.type,
        text: op.text,
        note: op.note,
        data: op.data,
        created: existing?.created ?? now,
        modified: now,
      };
    } else if (existing) {
      existing.deleted = true;
      existing.modified = now;
    } else {
      // Tombstone for an id we never stored (e.g. an annotation baked into the PDF): keeps it deleted.
      file.annotations[op.id] = { id: op.id, page: 0, type: '', text: '', note: '', data: {}, created: now, modified: now, deleted: true };
    }
    file.log.push({ rev: file.rev, op: op.op, id: op.id, at: now });
  }
  if (file.log.length > MAX_ANNOTATION_LOG) file.log = file.log.slice(-MAX_ANNOTATION_LOG);
}

async function patchAnnotations(
  key: string,
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_ANNOTATION_BODY) throw new HttpError(413, 'Request too large');
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  const ops = sanitizeOps(parsed);

  for (let attempt = 0; attempt < MAX_ANNOTATION_RETRIES; attempt++) {
    // Another device wrote first: wait a random moment so competing writers don't collide again in lockstep.
    if (attempt > 0) await new Promise((r) => setTimeout(r, Math.random() * 40 * attempt));
    const { data, etag } = await readAnnotations(key, env);
    applyAnnotationOps(data, ops);

    const body = JSON.stringify(data);
    if (body.length > MAX_ANNOTATIONS_FILE) throw new HttpError(413, 'Annotations file is full');

    const result = await env.PDF_BUCKET.put(annotationsKey(key), body, {
      httpMetadata: { contentType: 'application/json' },
      // null result => someone else wrote in between => retry on top of their version
      onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
    });
    if (result) return json({ success: true, rev: data.rev, applied: ops.length }, cors);
  }
  throw new HttpError(409, 'Annotations are busy, please retry');
}
