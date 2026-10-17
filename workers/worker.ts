/**
 * Cloudflare Worker for the BAWS PDF Library (R2 + centralized metadata)
 *
 * R2 layout – folders are DISCOVERED, nothing is hard-coded:
 *   <any-folder>/  *.pdf, metadata.json (optional – reading progress, created automatically)
 *   _versions/<key>/<timestamp>.pdf     (rolling backups made before every overwrite)
 *   Annotation/<folder>/<name>.json     (one annotations file per PDF, created automatically on first save)
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
    'Access-Control-Allow-Methods': 'GET, HEAD, PUT, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range, If-None-Match, If-Match',
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
  const folders = await listFolders(env);

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
            readingTime: entry?.readingTime ?? 0,
            view: sanitizeView(entry?.view) ?? null,
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

/** Copy the current object to _versions/<key>/<timestamp>.pdf and prune old copies. */
async function backupExisting(key: string, env: Env): Promise<void> {
  const existing = await env.PDF_BUCKET.get(key);
  if (!existing) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = `_versions/${key}/`;
  await env.PDF_BUCKET.put(`${prefix}${stamp}.pdf`, existing.body, {
    httpMetadata: { contentType: 'application/pdf' },
  });

  const versions = await env.PDF_BUCKET.list({ prefix });
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
