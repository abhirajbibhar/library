import { createPdfiumDirectEngine } from '@embedpdf/engines';
import { API_BASE } from '../config';
import { WASM_URL } from './viewer-assets';
import { putCover } from './db';
import type { PdfDocument } from '../types';

// The same PDFium engine the reader uses (and the same wasm file, already cached by the browser) draws the covers
// and reads what each PDF says about itself, so there is no second PDF library and nothing is loaded from a CDN.
const COVER_WIDTH = 360; // px, plenty for a 180px card on a 2x screen

type Engine = Awaited<ReturnType<typeof createPdfiumDirectEngine>>;
let enginePromise: Promise<Engine> | null = null;

function getEngine(): Promise<Engine> {
  enginePromise ??= createPdfiumDirectEngine(WASM_URL, { fontFallback: null }).catch((err) => {
    enginePromise = null; // allow a retry later
    throw err;
  });
  return enginePromise;
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

/** Author, subject and language the PDF file itself declares. Only values that look real are returned. */
function detailsFrom(meta: { author?: string | null; subject?: string | null; custom?: unknown } | null): PdfDetails {
  const out: PdfDetails = {};
  const author = clean(meta?.author, 120);
  if (author.length >= 2 && !GENERIC_AUTHOR.test(author)) out.author = author;
  const subject = clean(meta?.subject, 1000);
  if (subject.length >= 20) out.description = subject; // short subjects are usually just the title again
  const language = clean((meta?.custom as Record<string, unknown> | undefined)?.Language, 40);
  if (language) out.language = language;
  return out;
}

async function readBytes(source: File | string): Promise<ArrayBuffer> {
  if (typeof source !== 'string') return source.arrayBuffer();
  const res = await fetch(source, { credentials: 'include' });
  if (!res.ok) throw new Error(`Could not read the PDF (${res.status})`);
  return res.arrayBuffer();
}

/** Reads a PDF once and returns what the file says about itself, plus a JPEG of page 1 (unless skipCover). */
export async function inspectPdf(source: File | string, opts: { skipCover?: boolean } = {}): Promise<{ cover: Blob | null; details: PdfDetails }> {
  const [content, engine] = await Promise.all([readBytes(source), getEngine()]);
  const doc = await engine.openDocumentBuffer({ id: `inspect-${Date.now()}-${Math.random().toString(36).slice(2)}`, content }).toPromise();
  try {
    const details = detailsFrom(await engine.getMetadata(doc).toPromise().catch(() => null));
    if (opts.skipCover) return { cover: null, details };
    const page = doc.pages[0];
    if (!page) throw new Error('This PDF has no pages');
    // Rendered on an opaque white background (the engine's default), encoded as JPEG
    const options = { scaleFactor: COVER_WIDTH / page.size.width, imageType: 'image/jpeg', quality: 0.82 } as Parameters<Engine['renderPage']>[2];
    const cover = await engine.renderPage(doc, page, options).toPromise();
    return { cover, details };
  } finally {
    void engine.closeDocument(doc).toPromise().catch(() => {});
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
