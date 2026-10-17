# Code review – BAWS PDF Library

Verified by: `tsc` (frontend + worker), production build, the real worker running on a local R2 emulator
(`wrangler dev --local`), and a headless-Chromium run of the real viewer against a 30-page PDF.

## 1. Bugs found and fixed

| # | Severity | Where | Problem | Fix |
|---|----------|-------|---------|-----|
| 1 | **High** | ViewerPage | Saved progress was overwritten with page 1 while the viewer was still starting up. Reproduced: fast load → page 12 became 1 at ~2 s and stayed 1; slow PDF download (1.5 s) → 12 became 1 at ~0.8 s. Cause: debounced effect ran on the *default* state `{lastPage:1}` and on the viewer's initial "page 1" event before the resume scroll. | Progress is only persisted after the saved page has been restored (`trackingRef`). If restoring fails, saving is paused and the user can "Go to page N" / "Start from here". |
| 2 | **High** | ViewerPage | The "save on unmount" effect had `[id, metadata]` deps, so its cleanup ran on *every* page change, sending a stale write each time (out-of-order writes could overwrite newer ones). | Replaced with one debounced saver + flush on unmount, `pagehide`, and `visibilitychange` (`keepalive` fetch). |
| 3 | **High** | ViewerPage | Switching document (`:id` change) kept the previous document's metadata in state → could write doc A's page to doc B. | All per-document state is reset when `id` changes; loads are cancellable (`AbortController`) and ignore stale responses. |
| 4 | **High** | Worker | `metadata.json` read-modify-write was not atomic → concurrent updates lost data. A JSON parse error was swallowed and the file **replaced with an empty one** (wipes everyone's progress). | Conditional writes (etag) with retry; corrupt file ⇒ HTTP 500, never overwritten. |
| 5 | **High** | Worker | `PUT /api/documents/<any key>` could write anything, including `metadata.json`; no size/format check; overwrote the original PDF with no backup. | Key allow-list (known folders, `.pdf`, no traversal), `%PDF` check, size limit, rolling backups in `_versions/` (last 3). |
| 6 | Medium | ViewerPage | After Save the viewer was remounted (lost zoom/scroll, raced with resume logic). Unsaved annotations were silently lost on navigation. | No remount; "Unsaved" badge, `beforeunload` + in-app leave confirmation, Ctrl/⌘+S. |
| 7 | Medium | ViewerPage | Blob URLs never revoked (memory leak per document). Resume used a fixed `setTimeout(1000)` + blind retries. | Revoked on cleanup. Resume uses `onLayoutReady` and verifies the page was reached. |
| 8 | Medium | Worker | `GET /api/documents` wrote `metadata.json` as a side effect; faked `lastOpened` with the upload date; ignored R2 pagination (>1000 files); `.PDF` ignored; `decodeURIComponent` errors returned 500. | Read-only, `lastOpened: null` = never opened, paginated, case-insensitive, 400 on bad encoding. |
| 9 | Medium | LibraryPage | Library loaded 3× on mount (mount + route effect + focus), every focus/visibility event refetched and flashed the spinner, slow responses could overwrite newer ones. | Single load, quiet refresh at most every 15 s, latest-request-wins. |
| 10 | Medium | Theme | Inline script forced "light" first → white flash for dark users; `light` and `dark` classes both set on `<html>`; unvalidated `localStorage` (throws in private mode); iframe `postMessage` theme not reflected in React. | Resolved before first paint, mutually exclusive classes, safe storage, listens to OS + parent. |
| 11 | Low | Types | `PdfDocument.lastOpened: number` but API returns ISO strings; dead fields (`thumbnail`, `source`, …). | Types match the API. |
| 12 | Low | Tooling | `r2:upload:*` scripts could never work (no `--file`); worker not type-checked (5 errors); `wrangler` not a dependency; README described an API that no longer exists and linked a missing `DEPLOYMENT.md`. | Fixed all. |
| 14 | Medium | Mobile layout | `h-screen` (`100vh`) ignores the phone browser's collapsing address/tool bars, so the viewer's bottom (page navigation) was pushed off-screen and only reachable by scrolling the whole page. | `h-dvh` (dynamic viewport) with a `100vh` fallback, safe-area bottom padding, `viewport-fit=cover`, page overscroll disabled. |
| 13 | Low | UX | Save error text hidden on mobile; icon buttons without `aria-label`; "Page 1" shown for never-opened books; unknown routes rendered blank. | Fixed. |

Performance: the library entry chunk dropped from 1,309 kB to 183 kB (viewer is lazy-loaded). Removed the global
`* { transition }` rule.

## 2. NOT fixed – needs your decision

1. **The Worker API has no authentication.** The Cloudflare Access logout link only protects the Pages site; the
   `*.workers.dev` API is open: anyone who learns the URL can list, download **and overwrite** your PDFs.
   `ALLOWED_ORIGIN` (CORS) only restrains browsers, it is not security. Recommended: serve the API from the same
   Access-protected hostname (Pages Functions or a Worker route on your domain) and/or verify the
   `Cf-Access-Jwt-Assertion` JWT in the Worker.
2. **Runtime third-party dependencies.** EmbedPDF loads `pdfium.wasm` from jsdelivr, a stamps manifest from jsdelivr
   and Open Sans from Google Fonts. If any is blocked/offline the viewer sits on "Loading document…". Self-host the
   wasm (the config supports a custom wasm URL) – required anyway for an offline/PWA mode.
3. Whole PDF is downloaded into a Blob before the viewer starts (the worker now supports Range/ETag, so streaming
   directly from the URL is possible).

## 3. Feature ideas (roughly by value / effort)

* **Auto-save annotations** (debounced, using the new dirty tracking) – removes the "forgot to Save" failure mode.
* **Sidecar annotations**: store annotations as JSON (the worker already has `/api/annotations/:key`, unused)
  instead of rewriting a 50 MB PDF each time; enables undo history, export, and cross-volume annotation search.
* **Bookmarks + outline/TOC panel** and **full-text search** (EmbedPDF ships `plugin-bookmark` and `plugin-search`).
* **Per-document view state** (zoom, scroll mode) saved with progress.
* **Reading-time tracking** (`readingTime` already exists in the worker/metadata; nothing sends it) and simple stats/streaks.
* **Mark as read / favourites**, sorting (title, last opened, progress), filter by "in progress".
* **Cover thumbnails**: render page 1 once client-side, store in R2, show on cards.
* **PWA / offline reading**: cache PDFs with a service worker (needs self-hosted wasm).
* **Friendly titles** (e.g. "Volume 1 – Writings on…") via a `titles` map in `metadata.json`.
* Enable the shape/ink annotation tools (`annotation-shape` is currently disabled) and a theme toggle inside the viewer.
* Tests: Vitest for the worker with Miniflare (the concurrency/validation checks done manually here are a good start),
  one Playwright smoke test for resume + save, ESLint/Prettier, a CI `typecheck` + `build` step.
* Error boundary + toast system instead of per-page error blocks.

## 4. Deploying these changes

Deploy the **worker first, then the frontend** (the new frontend calls `GET /api/metadata/:key` and expects
`lastOpened: null` for unopened books). Existing `metadata.json` files are compatible. Backups appear under
`_versions/` in the bucket; add an R2 lifecycle rule if you want them to expire.

## 5. Not covered by my testing

Creating an annotation in the UI (the "Unsaved" badge on a real edit), a real Cloudflare deployment, very large
(multi-hundred-page, text-heavy) PDFs, and Safari/iOS behaviour of `keepalive`/`pagehide` saves.
