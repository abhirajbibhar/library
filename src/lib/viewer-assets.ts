import type { PDFViewerConfig } from '@embedpdf/react-pdf-viewer';
// Vite emits this file once, content-hashed, into dist/assets (no separate copy needed).
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';

/**
 * Everything the PDF viewer needs at runtime is served from our own origin (nothing from jsDelivr / Google).
 * The wasm is bundled by Vite and the UI font comes from @fontsource. PDF fallback fonts are switched off
 * (`fontFallback: null` in ViewerPage): the PDFs embed their own fonts, so nothing is fetched for them.
 *
 * URLs must be absolute: the engine runs in a Web Worker, where relative paths would resolve against the
 * worker script instead of the page.
 */
const asset = (path: string) => new URL(path, document.baseURI).href;

export const WASM_URL = asset(pdfiumWasmUrl);

/** Viewer UI font (Open Sans) comes from @fontsource via src/main.tsx, so no Google Fonts request. */
export const VIEWER_FONTS: NonNullable<PDFViewerConfig['fonts']> = {
  ui: { family: "'Open Sans', system-ui, sans-serif", stylesheetUrl: null },
  signature: null, // the signature tool is disabled anyway
};
