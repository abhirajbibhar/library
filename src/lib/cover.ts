import { API_BASE } from '../config';
import { putCover } from './db';
import type { PdfDocument } from '../types';

// pdf.js is only needed to draw page 1 once per book, so it is loaded on demand from a CDN instead of being bundled.
const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
const COVER_WIDTH = 360; // px, plenty for a 180px card on a 2x screen

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loader: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadPdfJs(): Promise<any> {
  loader ??= (async () => {
    const lib = await import(/* @vite-ignore */ `${PDFJS_BASE}pdf.min.mjs`);
    // Workers must be same-origin, so wrap the CDN worker script in a blob URL.
    const code = await (await fetch(`${PDFJS_BASE}pdf.worker.min.mjs`)).text();
    lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    return lib;
  })().catch((err) => {
    loader = null; // allow a retry later
    throw err;
  });
  return loader;
}

export interface PdfDetails {
  author?: string;
  description?: string;
  language?: string;
}

const GENERIC_AUTHOR = /^(unknown|anonymous|admin|administrator|user|owner|author|pdf|scanner|scan|microsoft|adobe|acrobat|word|libreoffice|writer)/i;

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Title, author and so on that the PDF file itself declares. Only values that look real are returned. */
function detailsFrom(meta: { info?: Record<string, unknown>; metadata?: { get?: (k: string) => unknown } } | null): PdfDetails {
  const info = meta?.info ?? {};
  const out: PdfDetails = {};
  const author = clean(info.Author, 120);
  if (author.length >= 2 && !GENERIC_AUTHOR.test(author)) out.author = author;
  const subject = clean(info.Subject, 1000);
  if (subject.length >= 20) out.description = subject; // short subjects are usually just the title again
  const language = clean(info.Language ?? meta?.metadata?.get?.('dc:language'), 40);
  if (language) out.language = language;
  return out;
}

async function openPdf(source: File | string) {
  const pdfjs = await loadPdfJs();
  const task =
    typeof source === 'string'
      ? pdfjs.getDocument({ url: source, withCredentials: true })
      : pdfjs.getDocument({ data: new Uint8Array(await source.arrayBuffer()) });
  return task.promise;
}

/** Reads a PDF once and returns what the file says about itself, plus a JPEG of page 1 (unless skipCover). */
export async function inspectPdf(source: File | string, opts: { skipCover?: boolean } = {}): Promise<{ cover: Blob | null; details: PdfDetails }> {
  const pdf = await openPdf(source);
  try {
    const details = detailsFrom(await pdf.getMetadata().catch(() => null));
    if (opts.skipCover) return { cover: null, details };
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: COVER_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const cover: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!cover) throw new Error('Could not create the cover image');
    return { cover, details };
  } finally {
    void pdf.destroy();
  }
}

/** Renders page 1 of a PDF (a local File, or one of our documents by URL) to a JPEG. */
export async function renderCover(source: File | string): Promise<Blob> {
  return (await inspectPdf(source)).cover!;
}

/** Author, description and language from a stored PDF (reads only the parts of the file it needs). */
export async function readPdfDetails(key: string): Promise<PdfDetails> {
  return (await inspectPdf(`${API_BASE}/documents/${encodeURIComponent(key)}`, { skipCover: true })).details;
}

/** Draws the cover from the stored PDF and saves it. Throws if the CDN or the PDF is unreachable. */
export async function generateCoverFor(doc: Pick<PdfDocument, 'id'>): Promise<void> {
  const blob = await renderCover(`${API_BASE}/documents/${encodeURIComponent(doc.id)}`);
  await putCover(doc.id, blob);
}

export const coverUrl = (doc: Pick<PdfDocument, 'id' | 'cover'>): string | null =>
  doc.cover ? `${API_BASE}/covers/${encodeURIComponent(doc.id)}?v=${doc.cover}` : null;
