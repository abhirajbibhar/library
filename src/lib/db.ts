import type { CollectionRecord, DocMeta, UserQuote } from '../types/api';
import type { AnnotationOp, AnnotationsFile, AnnotationSummary, PdfDocument, ReadingProgress, ReadingLog, StorageOverview, TrashEntry, VersionInfo } from '../types';
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
export const trashDocument = (id: string, opts?: RequestOptions): Promise<void> => storage.trashDocument(id, opts);
export const listTrash = (opts?: RequestOptions): Promise<TrashEntry[]> => storage.listTrash(opts);
export const restoreFromTrash = (trashId: string, opts?: RequestOptions): Promise<string> => storage.restoreFromTrash(trashId, opts);
export const purgeTrash = (trashId?: string, opts?: RequestOptions): Promise<void> => storage.purgeTrash(trashId, opts);
export const moveDocument = (from: string, to: string, opts?: RequestOptions): Promise<string> => storage.moveDocument(from, to, opts);
export const setDocState = (id: string, change: { favorite?: boolean; tags?: string[]; meta?: DocMeta }, opts?: RequestOptions) =>
  storage.setDocState(id, change, opts);
export const getQuotes = (opts?: RequestOptions): Promise<UserQuote[]> => storage.getQuotes(opts);
export const saveQuotes = (quotes: UserQuote[], opts?: RequestOptions): Promise<UserQuote[]> => storage.saveQuotes(quotes, opts);
export const getCollections = (opts?: RequestOptions): Promise<CollectionRecord[]> => storage.getCollections(opts);
export const saveCollections = (collections: CollectionRecord[], opts?: RequestOptions): Promise<CollectionRecord[]> =>
  storage.saveCollections(collections, opts);
export const getReading = (opts?: RequestOptions): Promise<ReadingLog> => storage.getReading(opts);
export const logReading = (id: string, seconds: number, day: string, opts?: { keepalive?: boolean }): Promise<void> =>
  storage.logReading(id, seconds, day, opts);
export const setReadingGoal = (minutes: number, opts?: RequestOptions): Promise<void> => storage.setReadingGoal(minutes, opts);
export const putCover = (id: string, image: Blob, opts?: RequestOptions): Promise<void> => storage.putCover(id, image, opts);
export const listVersions = (id: string, opts?: RequestOptions): Promise<VersionInfo[]> => storage.listVersions(id, opts);
export const restoreVersion = (id: string, versionId: string, opts?: RequestOptions): Promise<void> =>
  storage.restoreVersion(id, versionId, opts);
