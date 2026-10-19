import type { DocMeta } from '../types/api';
import type { UserQuote } from '../types/api';
import type { AnnotationOp, AnnotationsFile, AnnotationSummary, PdfDocument, ReadingProgress, ReadingLog, StorageOverview, TrashEntry, VersionInfo } from '../types';

export interface RequestOptions {
  signal?: AbortSignal;
  /** Lets a request finish while the page is being closed/navigated away. */
  keepalive?: boolean;
}

/** A PDF plus the server version (ETag) it came from. */
export interface VersionedPdf {
  blob: Blob;
  etag: string | null;
}

/** Thrown by saveDocument when the PDF was changed elsewhere since `ifMatch`. */
export class ConflictError extends Error {
  constructor(message = 'Changed on another device') {
    super(message);
    this.name = 'ConflictError';
  }
}

export interface StorageBackend {
  getLibrary(opts?: RequestOptions): Promise<PdfDocument[]>;
  getDocument(id: string, opts?: RequestOptions): Promise<Blob>;
  /** Returns null when `ifNoneMatch` still equals the server version (nothing new). */
  fetchDocument(id: string, opts?: RequestOptions & { ifNoneMatch?: string | null }): Promise<VersionedPdf | null>;
  /** `ifMatch` makes the save fail with ConflictError if the server copy changed. Returns the new ETag. */
  saveDocument(id: string, pdf: Blob, opts?: RequestOptions & { ifMatch?: string | null }): Promise<string | null>;
  /** Upload a new PDF (or replace one) with progress. Resolves with the new ETag. */
  uploadDocument(
    id: string,
    file: Blob,
    opts?: RequestOptions & { onProgress?: (fraction: number) => void },
  ): Promise<string | null>;
  /** "Delete": moves the PDF with its annotations, cover and backups to the trash (kept 30 days). */
  trashDocument(id: string, opts?: RequestOptions): Promise<void>;
  listTrash(opts?: RequestOptions): Promise<TrashEntry[]>;
  restoreFromTrash(trashId: string, opts?: RequestOptions): Promise<string>;
  /** Deletes one trash entry for good, or every entry when no id is given. */
  purgeTrash(trashId?: string, opts?: RequestOptions): Promise<void>;
  /** Renames and/or moves a PDF (annotations, progress, cover and backups follow it). Resolves with the new key. */
  moveDocument(from: string, to: string, opts?: RequestOptions): Promise<string>;
  setDocState(id: string, change: { favorite?: boolean; tags?: string[]; meta?: DocMeta }, opts?: RequestOptions): Promise<{ favorite: boolean; tags: string[]; meta: DocMeta }>;
  getQuotes(opts?: RequestOptions): Promise<UserQuote[]>;
  saveQuotes(quotes: UserQuote[], opts?: RequestOptions): Promise<UserQuote[]>;
  getReading(opts?: RequestOptions): Promise<ReadingLog>;
  logReading(id: string, seconds: number, day: string, opts?: { keepalive?: boolean }): Promise<void>;
  setReadingGoal(minutes: number, opts?: RequestOptions): Promise<void>;
  putCover(id: string, image: Blob, opts?: RequestOptions): Promise<void>;
  listVersions(id: string, opts?: RequestOptions): Promise<VersionInfo[]>;
  restoreVersion(id: string, versionId: string, opts?: RequestOptions): Promise<void>;
  getStorage(opts?: RequestOptions): Promise<StorageOverview>;
  /** Every annotation across all PDFs, newest first. */
  getAllAnnotations(opts?: RequestOptions): Promise<AnnotationSummary[]>;
  getMetadata(id: string, opts?: RequestOptions): Promise<ReadingProgress>;
  updateMetadata(id: string, metadata: ReadingProgress, opts?: RequestOptions): Promise<void>;
  /** Annotations stored as JSON next to (not inside) the PDF. Returns an empty file (rev 0) if none saved yet. */
  getAnnotations(id: string, opts?: RequestOptions): Promise<AnnotationsFile>;
  /** Sends only what changed; the server merges by annotation id. Returns the new revision. */
  patchAnnotations(id: string, ops: AnnotationOp[], opts?: RequestOptions): Promise<number>;
}
