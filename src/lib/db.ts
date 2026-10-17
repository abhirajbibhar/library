import type { AnnotationOp, AnnotationsFile, AnnotationSummary, PdfDocument, ReadingProgress, StorageOverview } from '../types';
import type { StorageBackend, RequestOptions, VersionedPdf } from './storage-interface';
export { ConflictError } from './storage-interface';
import { RemoteStorageBackend } from './remote-storage';

const storage: StorageBackend = new RemoteStorageBackend();

export const getLibrary = (opts?: RequestOptions): Promise<PdfDocument[]> => storage.getLibrary(opts);
export const getDocument = (id: string, opts?: RequestOptions): Promise<Blob> => storage.getDocument(id, opts);
export const fetchDocument = (
  id: string,
  opts?: RequestOptions & { ifNoneMatch?: string | null },
): Promise<VersionedPdf | null> => storage.fetchDocument(id, opts);
export const saveDocument = (
  id: string,
  pdf: Blob,
  opts?: RequestOptions & { ifMatch?: string | null },
): Promise<string | null> => storage.saveDocument(id, pdf, opts);
export const getMetadata = (id: string, opts?: RequestOptions): Promise<ReadingProgress> =>
  storage.getMetadata(id, opts);
export const updateMetadata = (id: string, metadata: ReadingProgress, opts?: RequestOptions): Promise<void> =>
  storage.updateMetadata(id, metadata, opts);
export const getAnnotations = (id: string, opts?: RequestOptions): Promise<AnnotationsFile> =>
  storage.getAnnotations(id, opts);
export const patchAnnotations = (id: string, ops: AnnotationOp[], opts?: RequestOptions): Promise<number> =>
  storage.patchAnnotations(id, ops, opts);
export const uploadDocument = (
  id: string,
  file: Blob,
  opts?: RequestOptions & { onProgress?: (fraction: number) => void },
): Promise<string | null> => storage.uploadDocument(id, file, opts);
export const getStorage = (opts?: RequestOptions): Promise<StorageOverview> => storage.getStorage(opts);
export const getAllAnnotations = (opts?: RequestOptions): Promise<AnnotationSummary[]> =>
  storage.getAllAnnotations(opts);
