/** Per-document viewer state, saved with reading progress and restored on open. */
export interface ViewState {
  /** A zoom factor (1 = 100%) or a mode that adapts to each screen. */
  zoom?: number | 'automatic' | 'fit-page' | 'fit-width';
  scrollMode?: 'vertical' | 'horizontal';
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
  readingTime: number;
  view?: ViewState | null;
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
