/** Per-document viewer state, saved with reading progress and restored on open. */
export interface ViewState {
  /** A zoom factor (1 = 100%) or a mode that adapts to each screen. */
  zoom?: number | 'automatic' | 'fit-page' | 'fit-width';
  scrollMode?: 'vertical' | 'horizontal';
}

/** Optional details the person fills in on the book page. */
export interface DocMeta {
  author?: string;
  description?: string;
  publishedYear?: number;
  language?: string;
  isbn?: string;
  rating?: number; // 1-5
}

/** Shape returned by GET /api/documents */
export interface PdfDocument {
  id: string; // R2 key, e.g. "My-Folder/Volume-01.pdf"
  name: string;
  folder: string; // top-level R2 folder – every folder becomes a section in the library
  folderTitle: string; // heading for that section (folder name unless metadata.json sets "title")
  size: number;
  lastModified: string; // ISO date (R2 upload time)
  lastPage: number;
  totalPages: number; // 0 until the document has been opened once
  lastOpened: string | null; // ISO date, null = never opened
  readingTime: number; // seconds actually spent reading
  view?: ViewState | null;
  favorite: boolean;
  tags: string[];
  meta: DocMeta;
  cover: number | null; // upload time (ms) of the cover image, null = none yet
}

/** Shape of GET/PUT /api/metadata/:key */
export interface ReadingProgress {
  lastPage: number;
  totalPages: number;
  lastOpened?: string | null;
  readingTime?: number;
  view?: ViewState | null;
}

/** One annotation in Annotation/<folder>/<name>.json. `data` is the viewer's own annotation object. */
export interface StoredAnnotation {
  id: string;
  page: number; // 1-based
  type: string;
  text: string; // selected text (highlights)
  note: string; // user's comment
  data: Record<string, unknown>;
  created: string;
  modified: string;
  deleted?: boolean;
}

/** Shape of GET /api/annotations/:key – `rev` is 0 until the first annotation is saved. */
export interface AnnotationsFile {
  pdfId: string;
  version: number;
  rev: number;
  lastUpdated: string;
  annotations: Record<string, StoredAnnotation>;
}

/** One change sent to PATCH /api/annotations/:key. */
export type AnnotationOp =
  | { op: 'delete'; id: string }
  | { op: 'upsert'; id: string; page: number; type: string; text: string; note: string; data: Record<string, unknown> };

/** Shape of GET /api/storage */
export interface StorageOverview {
  total: number; // bytes used in the whole bucket
  folders: { name: string; size: number; count: number }[];
  backups: number; // _versions/
  trash: number; // _trash/
  annotations: number; // Annotation/
  other: number;
}

/** One entry of GET /api/annotations (every live annotation across all PDFs, newest first). */
export interface AnnotationSummary {
  docId: string;
  folder: string;
  docName: string;
  id: string;
  page: number;
  type: string;
  text: string; // selected text of a highlight ('' for a plain note)
  note: string;
  color: string | null; // "#rrggbb" when the viewer saved one
  created: string;
  modified: string;
}

/** One deleted document waiting in the trash (GET /api/trash). */
export interface TrashEntry {
  id: string;
  key: string;
  name: string;
  folder: string;
  size: number;
  deletedAt: string;
  expiresAt: string;
}

/** GET /api/reading: seconds read per local day ("YYYY-MM-DD") and the optional daily goal. */
export interface ReadingLog {
  days: Record<string, number>;
  dayDocs: Record<string, Record<string, number>>; // day -> pdf key -> seconds (last ~4 months)
  goalMinutes: number; // 0 = no goal
}

/** One earlier copy of a PDF (GET /api/versions/:key). */
export interface VersionInfo {
  id: string;
  size: number;
  uploaded: string;
}

/** A collection as stored by the Worker (bookIds are PDF keys). */
export interface CollectionRecord {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  bookIds: string[];
  createdAt: string;
}

/** A quote you picked, with its attribution (stored in _library/quotes.json). */
export interface UserQuote {
  id: string;
  text: string;
  author: string;
  book: string;
  year: number | null;
  page: number | null;
  note: string;
  bookKey: string; // the PDF it came from, '' if typed in
  addedAt: string;
}
