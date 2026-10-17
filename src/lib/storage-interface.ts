import type { AnnotationOp, AnnotationsFile, AnnotationSummary, PdfDocument, ReadingProgress, StorageOverview } from '../types';

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
  /** Deletes the PDF plus its annotations, backups and progress. Cannot be undone. */
  deleteDocument(id: string, opts?: RequestOptions): Promise<void>;
  /** Deletes a folder and everything in it. Cannot be undone. */
  deleteFolder(name: string, opts?: RequestOptions): Promise<void>;
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
