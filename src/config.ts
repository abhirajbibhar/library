// All deployment-specific values live here (override with .env / Cloudflare Pages variables).
// Same origin as the page (the Worker serves both), so a relative path is enough.
export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? '/api';

export const HOME_URL: string = import.meta.env.VITE_HOME_URL ?? '/';

export const LOGOUT_URL: string =
  import.meta.env.VITE_LOGOUT_URL ?? '/cdn-cgi/access/logout';

export const ANNOTATION_AUTHOR: string = import.meta.env.VITE_ANNOTATION_AUTHOR ?? 'Abhiraj Bibhar';

/**
 * How the viewer opens PDFs: 'range-request' streams only the byte ranges it needs (the default),
 * 'full-fetch' downloads the whole file first, 'auto' lets the viewer decide. Set VITE_PDF_LOAD_MODE to switch.
 */
export const PDF_LOAD_MODE = (import.meta.env.VITE_PDF_LOAD_MODE ?? 'range-request') as
  | 'auto'
  | 'range-request'
  | 'full-fetch';
