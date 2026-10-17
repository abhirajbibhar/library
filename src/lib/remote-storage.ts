import { ConflictError, type StorageBackend, type RequestOptions, type VersionedPdf } from './storage-interface';
import type { AnnotationOp, AnnotationsFile, AnnotationSummary, PdfDocument, ReadingProgress, StorageOverview } from '../types';
import { API_BASE } from '../config';

/**
 * R2 storage backend (Cloudflare Worker + centralized metadata.json)
 *
 * GET  /documents          list PDFs with reading progress
 * GET  /documents/:key     download PDF
 * PUT  /documents/:key     save annotated PDF (server keeps backups)
 * GET  /metadata/:key      reading progress for one PDF
 * PUT  /metadata/:key      update reading progress
 * GET  /annotations/:key   annotations JSON (Annotation/<folder>/<name>.json)
 * PATCH /annotations/:key  merge annotation changes into that JSON
 */
async function fail(response: Response, what: string): Promise<never> {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error ? `: ${body.error}` : '';
  } catch {
    /* body wasn't JSON */
  }
  throw new Error(`${what} (${response.status}${detail})`);
}

const enc = encodeURIComponent;

export class RemoteStorageBackend implements StorageBackend {
  async getLibrary(opts: RequestOptions = {}): Promise<PdfDocument[]> {
    const res = await fetch(`${API_BASE}/documents`, { signal: opts.signal });
    if (!res.ok) await fail(res, 'Failed to fetch library');
    return res.json();
  }

  async getDocument(id: string, opts: RequestOptions = {}): Promise<Blob> {
    const res = await fetch(`${API_BASE}/documents/${enc(id)}`, { signal: opts.signal });
    if (!res.ok) await fail(res, 'Failed to fetch PDF');
    return res.blob();
  }

  async fetchDocument(
    id: string,
    opts: RequestOptions & { ifNoneMatch?: string | null } = {},
  ): Promise<VersionedPdf | null> {
    const res = await fetch(`${API_BASE}/documents/${enc(id)}`, {
      signal: opts.signal,
      cache: 'no-store',
      headers: opts.ifNoneMatch ? { 'If-None-Match': opts.ifNoneMatch } : undefined,
    });
    if (res.status === 304) return null;
    if (!res.ok) await fail(res, 'Failed to fetch PDF');
    return { blob: await res.blob(), etag: res.headers.get('ETag') };
  }

  async saveDocument(
    id: string,
    pdf: Blob,
    opts: RequestOptions & { ifMatch?: string | null } = {},
  ): Promise<string | null> {
    const headers: Record<string, string> = { 'Content-Type': 'application/pdf' };
    if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
    const res = await fetch(`${API_BASE}/documents/${enc(id)}`, {
      method: 'PUT',
      body: pdf,
      headers,
      signal: opts.signal,
    });
    if (res.status === 412) throw new ConflictError();
    if (!res.ok) await fail(res, 'Failed to save PDF');
    const body = await res.json().catch(() => null);
    return body?.etag ?? null;
  }

  /** XHR instead of fetch: fetch cannot report upload progress. */
  uploadDocument(
    id: string,
    file: Blob,
    opts: RequestOptions & { onProgress?: (fraction: number) => void } = {},
  ): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `${API_BASE}/documents/${enc(id)}`);
      xhr.setRequestHeader('Content-Type', 'application/pdf');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
        let body: { etag?: string; error?: string } | null = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* not JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body?.etag ?? null);
        else reject(new Error(body?.error ? body.error : `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
      opts.signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(file);
    });
  }

  async getStorage(opts: RequestOptions = {}): Promise<StorageOverview> {
    const res = await fetch(`${API_BASE}/storage`, { signal: opts.signal, cache: 'no-store' });
    if (!res.ok) await fail(res, 'Failed to fetch storage');
    return res.json();
  }

  async getAllAnnotations(opts: RequestOptions = {}): Promise<AnnotationSummary[]> {
    const res = await fetch(`${API_BASE}/annotations`, { signal: opts.signal, cache: 'no-store' });
    if (!res.ok) await fail(res, 'Failed to fetch annotations');
    const body = await res.json();
    return Array.isArray(body?.items) ? body.items : [];
  }

  async getMetadata(id: string, opts: RequestOptions = {}): Promise<ReadingProgress> {
    const res = await fetch(`${API_BASE}/metadata/${enc(id)}`, { signal: opts.signal });
    if (!res.ok) await fail(res, 'Failed to fetch progress');
    return res.json();
  }

  async updateMetadata(id: string, metadata: ReadingProgress, opts: RequestOptions = {}): Promise<void> {
    const res = await fetch(`${API_BASE}/metadata/${enc(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
      keepalive: opts.keepalive,
      signal: opts.signal,
    });
    if (!res.ok) await fail(res, 'Failed to update progress');
  }

  async getAnnotations(id: string, opts: RequestOptions = {}): Promise<AnnotationsFile> {
    const res = await fetch(`${API_BASE}/annotations/${enc(id)}`, { signal: opts.signal, cache: 'no-store' });
    if (!res.ok) await fail(res, 'Failed to fetch annotations');
    return res.json();
  }

  async patchAnnotations(id: string, ops: AnnotationOp[], opts: RequestOptions = {}): Promise<number> {
    const res = await fetch(`${API_BASE}/annotations/${enc(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops }),
      keepalive: opts.keepalive,
      signal: opts.signal,
    });
    if (!res.ok) await fail(res, 'Failed to save annotations');
    const body = await res.json().catch(() => null);
    return typeof body?.rev === 'number' ? body.rev : 0;
  }
}
