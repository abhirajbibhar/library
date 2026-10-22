# BAWS PDF Library — App Documentation

A cloud-native personal library and PDF reader for Babasaheb Ambedkar's Writings & Speeches (and any PDFs you add), built with **React 18 + TypeScript + Vite** on the frontend and **Cloudflare Workers + R2** on the backend, protected by **Cloudflare Access**.

---

## 1. Features

### 1.1 Library & Books
- **Card-based library** (`/library`) with search (title, author, tags), collection filter, sorting, and Grid / List view toggle — all visible on mobile in a single compact toolbar row (Collection Filter | Sorting | Grid/List).
- **Book cards**: clean cover image (rendered from page 1) or a coloured initial-card fallback; rating stars, favourite ★ and offline badges float over the cover; title, author/tags, folder badge, progress % and the ⋯ options menu sit in a **compact footer below the cover** with a soft gradient fade, keeping card height small.
- **Reading status badges** — *Started* / *Reading* / *Finished* derived from progress and last-opened date.
- **Upload** PDFs into any folder (or a new one) via the Upload modal; covers are auto-generated server-side.
- **Folders as sections**: every top-level R2 folder containing PDFs becomes a section automatically — no code changes needed. Hidden/system folders are ignored.
- **Metadata editing**: title, author, tags, genre/folder via the book ⋯ menu and detail page.
- **Collections** (`/collections`, `/collections/:id`): user-made groupings of books with their own create/rename/delete flows.

### 1.2 Reading
- **Embedded PDF reader** (`/reader/:id`) powered by EmbedPDF (PDFium WASM) — full-bleed layout with its own toolbar.
- **Smart resume**: opens at the last page you were on, even after closing the browser; page position is debounced and synced to the server.
- **Annotations**: highlight, underline and sticky-note text annotations stored per document and synced across devices.
- **Dark/light paper mode** for the page canvas; keyboard-friendly navigation.
- **Reading-time tracking**: seconds spent reading are logged per day (`/streak`) and per book.

### 1.3 Dashboard (`/`)
- Greeting + quick stats, **"Today's plan"** card (daily goal progress) placed just before the **Continue Reading** shelf, recently added books, and streak summary.

### 1.4 Notes & Highlights (`/notes`)
- All highlights and notes across the library in one feed, grouped by book, rendered **full-width inside their parent cards**, with jump-to-page links and quote/share actions.

### 1.5 Notebook (`/notebook`)
- Date-based free-form notes (like a journal); each day is its own entry stored remotely.

### 1.6 Quotes (`/quotes`)
- Curated quote records extracted from your highlights, editable and exportable.

### 1.7 Day Streak (`/streak`, `/streak/:date`)
- Calendar of reading days with per-day detail (time read, pages, sessions) to build a daily reading habit.

### 1.8 Trash (`/trash`)
- Soft-deleted books land here; restore or purge permanently.

### 1.9 Settings (`/settings`)
- Daily reading goal (minutes), storage usage report, offline management (auto-keep N recent books vs pinned), Cloudflare Access session info, and sign-out that wipes local/offline data first.

### 1.10 Offline & Multi-device
- **PWA**: installable (`manifest.webmanifest`), service worker caches opened books; works behind Cloudflare Access (`crossorigin="use-credentials"`).
- **Offline reading**: saved books open without a connection; annotation/progress edits queue and sync when back online (amber offline banner in the header).
- **Multi-device sync**: state lives in R2; the header Refresh button pulls the latest annotations/progress from other devices (dirty-dot shows unsaved local changes).

### 1.11 Security
- Every API request is verified against **Cloudflare Access JWTs** (JWKS fetched and cached by the Worker). Optional defence-in-depth: the Worker can enforce its own `ACCESS_POLICY` secret so the app stays locked even if Access is misconfigured at the dashboard level.

---

## 2. Design

### 2.1 Visual language
- **Dark-only UI** (`gray-950` background, `gray-900` surfaces, `gray-800` borders/hover) painted before React boots to avoid white flash; `color-scheme: dark`.
- Accent colours: blue (primary/actions/links), amber (favourites/warnings), green (success/offline-available), red (destructive).
- Compact typography scale: 10–13 px meta text on cards, `text-sm` body, `line-clamp` truncation everywhere.
- Oriya subtitle under the brand uses **Noto Sans Oriya** (preconnected Google Fonts).
- **App icon**: `favicon.svg` (from abhirajbibhar.pages.dev) used as the tab favicon, sidebar/header brand logo, and PWA icon source.

### 2.2 Layout shell (`src/components/Layout.tsx`)
- Fixed 64 px header: brand block aligned to sidebar width, contextual back-arrow on sub-pages, reader refresh button, online dot, logout.
- Sidebar (`w-64`) with independent scroll holding all nav items; on mobile it slides in over a dimmed overlay.
- **Desktop slide-out rail**: a collapse toggle **pinned at the bottom of the sidebar** shrinks it to a 68 px icon-only rail (`PanelLeftClose/Open` icons), giving maximum width to content. The choice persists in `localStorage` (`baws-sidebar-rail`).
- Main region scrolls independently; reader routes are "full-bleed" (no padding).
- Global shortcut: **Ctrl/⌘+K** jumps to library search.

### 2.3 Components
| Component | Role |
|---|---|
| `BookCard` | Cover + overlay badges + compact meta footer (title, author, folder, progress bar, ⋯ menu) |
| `Menu` | Icon-trigger dropdown (portal, fixed positioning, edge-flip, follows scroll/resize, closes on Esc/outside-click) |
| `Dropdown` | Select-style list (portal, collision-aware placement, internal scroll, checkmark on selection) |
| `Layout` | App shell described above |
| `ConfirmDialog` / `FormDialog` | Modal confirmations and metadata forms |
| `UploadModal` | Drag/select PDFs → upload with folder choice |
| `QuoteDialog` / `QuoteSection` | Quote capture and display |
| `Icon` | Shared inline SVG icon set |

### 2.4 Overlay/popover strategy
All floating UI (`Menu`, `Dropdown`) renders through `createPortal` into `document.body` with `position: fixed`, computed from the trigger's `getBoundingClientRect()`: flipped upward near the viewport bottom, clamped to screen edges, repositioned on scroll/resize, max-height with internal `overscroll-contain` scrolling — so they are never clipped by card/list containers.

---

## 3. Functions & Data Flow

### 3.1 Frontend architecture
```
src/
  main.tsx / App.tsx      – router (react-router-dom), routes listed below
  store/index.ts          – Zustand-style global LibraryStore (books, folders,
                            trash, settings, hydration from Worker) + Actions
  hooks/useDocActions.tsx – per-document actions (menu wiring, delete flow, etc.)
  lib/
    docs.ts / db.ts       – document state + IndexedDB local cache
    offline.ts            – Cache-based offline saving, auto-trim, clearOfflineData()
    remote-storage.ts     – HTTP client for the Worker API
    storage-interface.ts  – shared shape between local & remote stores
    readerBridge.ts       – live-reader bridge (refresh, dirty flag)
    cover.ts, format.ts, names.ts, markdown.tsx, zip.ts, export.ts, launchFiles.ts,
    platform.ts, viewer-assets.ts
  pages/                  – Dashboard, Library, BookDetail, Reader, Notes, Notebook,
                            Collections(+Detail), Quotes, DayStreak(+DayDetail),
                            Trash, Settings
  workers/worker.ts       – Cloudflare Worker source (deployed separately)
```

**Routes**: `/` dashboard · `/library` · `/book/:id` detail · `/reader/:id` · `/viewer/:id` (legacy redirect) · `/notes` · `/notebook[/:date]` · `/collections[/:id]` · `/quotes` · `/streak[/:date]` · `/trash` · `/settings`.

### 3.2 Backend API (Cloudflare Worker, `workers/worker.ts`)
All endpoints return JSON, carry CORS headers, and pass Access-JWT verification first.

| Area | Endpoints / functions | Notes |
|---|---|---|
| Library listing | `GET /api/library` | Lists R2 objects, groups by top-level folder, merges per-doc state |
| Document state | `PATCH /api/doc/:key/state` | Progress, last-read, view state (sanitised) |
| Annotations | `GET/PUT /api/annotations…` | Per-document highlight/note records |
| Reading log | `POST /api/reading/log`, `GET /api/reading`, `PUT /api/reading/goal` | Daily seconds + goal |
| Quotes | `GET/PUT /api/quotes` | Single JSON record file |
| Notebook | `GET/PUT/DELETE /api/note/:date` | One JSON file per date |
| Covers | `PUT/GET /api/cover/:key` | Generated PNG/JPEG sniffed on upload |
| Files | upload/download/move of PDFs under R2 keys | `assertPdfKey` guards key safety |
| **Cascade delete** | `documentObjectKeys(key)` + `deleteKeys()` | Deleting a **book** removes the PDF **plus** its cover, state, annotations, reading log and offline mirrors. Deleting a **folder/collection** enumerates every object under the prefix and deletes all associated side-files too. Client side, `dropAnnotationsForDoc(r2Key)` purges the same data from local caches/IndexedDB and the trash keeps restorable copies until purged. |

### 3.3 State & sync model
1. On mount, `refresh()` loads the whole library once; `visibilitychange`/`focus` triggers a quiet `refreshIfStale()`.
2. Edits write **optimistically** to the local store + IndexedDB, then push to the Worker; failures keep a pending queue and surface an error notice.
3. Offline saves use the Cache API (`saveForOffline`, `keepRecentOffline`, `trimAuto`, `removeOffline`); sign-out calls `clearOfflineData()` before redirecting to the Access logout URL so nothing remains on the device.

### 3.4 Deletion semantics (what "delete everything related" means)
Deleting a book or folder cascades across **every layer**:
- **R2**: the PDF object(s), generated cover, `.state.json`, annotation files, reading-log entries for those keys.
- **Trash**: hard-purge removes the above; soft-delete keeps a restorable copy.
- **Client**: store entries, IndexedDB caches, annotation maps (`dropAnnotationsForDoc`), and offline Cache entries for the removed keys.

---

## 4. Tech Stack & Deployment
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, lucide-react, react-router-dom, EmbedPDF (`@embedpdf/*`, PDFium WASM).
- **Backend**: Cloudflare Worker (TS) + R2 bucket (`baws`), Cloudflare Access (JWT + JWKS), Pages for the static app.
- **Deploy**: `wrangler deploy` runs the custom build (`tsc --noEmit && vite build`) and publishes both the Worker API and the static assets. Base URL: `https://library.abhirajbibhar.workers.dev`.
- **PWA**: `public/manifest.webmanifest` + `public/sw.js`; icons under `public/icons/`, brand SVG at `public/favicon.svg`.
