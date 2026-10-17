# BAWS PDF Library

A cloud-native PDF reader for Babasaheb Ambedkar's Writings and Speeches, built with React and Cloudflare R2.

## Features

- 📚 **Cloud-Powered Library** - All PDFs stored in Cloudflare R2, accessible from any device
- 📁 **Folders are sections** - Every top-level R2 folder with PDFs becomes a section headed by the folder name; add a folder, upload PDFs, done (no code change)
- ✏️ **Rich Annotations** - Highlight, underline, add notes directly on PDFs
- 💾 **Auto-Save Progress** - Reading progress and annotations sync automatically
- 📱 **Multi-Device Sync** - Start on phone, continue on laptop
- 🎨 **Clean UI** - Simple card-based interface with responsive design
- 🌙 **Dark Mode** - Toggle between light and dark themes, PDF viewer adapts automatically
- 🔄 **Smart Resume** - Automatically resumes from where you left off, even after closing the browser
- 📈 **Progress Tracking** - Visual progress bars showing pages read and completion percentage
- 🕐 **Last Opened** - See when you last opened each PDF

## Architecture

```
┌─────────────────┐
│   React App     │
│   (Frontend)    │
└────────┬────────┘
         │
         │ HTTP API
         │
┌────────▼────────┐
│ Cloudflare      │
│ Worker          │
└────────┬────────┘
         │
         │ R2 API
         │
┌────────▼────────┐
│  R2 Bucket      │
│  (baws)         │
│                 │
│  /<folder-a>/   │
│  /<folder-b>/   │
│  /...           │
└─────────────────┘
```

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **PDF Viewer**: EmbedPDF (@embedpdf/react-pdf-viewer)
- **Storage**: Cloudflare R2 (single bucket)
- **Backend**: Cloudflare Worker
- **Styling**: Tailwind CSS 4
- **Routing**: React Router

## Project Structure

```
├── src/
│   ├── App.tsx                      # Router
│   ├── main.tsx                     # Entry point
│   ├── index.css                    # Global styles
│   ├── types.ts                     # TypeScript types
│   ├── contexts/
│   │   └── ThemeContext.tsx          # Dark mode context
│   ├── pages/
│   │   ├── LibraryPage.tsx          # PDF library view
│   │   └── ViewerPage.tsx           # PDF reader with annotations
│   └── lib/
│       ├── db.ts                    # Storage API wrapper
│       ├── remote-storage.ts        # R2 API client
│       └── storage-interface.ts     # Type definitions
├── workers/
│   └── worker.ts                    # Cloudflare Worker
├── wrangler.toml                    # Worker configuration
├── vite.config.js                   # Vite configuration
└── package.json                     # Dependencies
```

## How It Works

### Library Page
1. Frontend calls `GET /api/documents`
2. Worker discovers every top-level folder in the R2 bucket (ignoring `_`/`.` folders) and lists the PDFs in each
3. Worker reads metadata (lastPage, totalPages, lastOpened) from each PDF
4. Frontend displays cards grouped by language

### Viewer Page
1. User clicks a PDF card
2. Frontend sends a small `HEAD /api/documents/{key}` (checks the PDF exists, gets its ETag) and
   `GET /api/annotations/{key}` (saved annotations) – the PDF itself is **not** downloaded up front
3. The viewer opens the PDF URL directly and **streams** it with HTTP range requests (see below)
4. Viewer resumes from lastPage and shows the saved annotations
5. User reads and annotates; changes autosave to a small JSON file

### Streaming the PDF
The viewer is given the worker's URL instead of a downloaded blob. It reads the end of the file (the PDF's
index) with `Range: bytes=-N`, then fetches only the byte ranges of the pages being shown, each answered
`206 Partial Content`. Every range request carries `If-Match: <ETag>`, so if the file is replaced while
someone is reading, the worker answers `412` instead of mixing two versions. Set `VITE_PDF_LOAD_MODE` to
`auto` or `full-fetch` to fall back to whole-file loading. Tip: `qpdf --linearize in.pdf out.pdf` before
uploading makes the first page appear after a single small request.

### Annotations (one JSON file per PDF)
Annotations are no longer baked into the PDF. They are stored next to it as JSON:

```
Speeches/Vol-01.pdf   ->   Annotation/Speeches/Vol-01.json
```

The worker creates this path itself on the first save (R2 has no real folders – a "folder" exists as soon
as an object with that prefix is written), so there is nothing to set up by hand. The `Annotation` folder is
reserved: it is never shown as a library section and PDFs cannot be uploaded into it.

- **Autosave:** ~1 s after the last change the viewer sends only what changed (`PATCH /api/annotations/{key}`
  with `upsert` / `delete` operations). The PDF is never re-uploaded. `Save` / Ctrl+S just does it right now.
- **Merging:** the worker merges by annotation id with optimistic concurrency (ETag + jittered retry), so
  two devices editing different annotations never overwrite each other. Same annotation edited twice → last write wins.
- **Deletes** are kept as tombstones, so a deletion also removes an annotation that is still embedded in an older PDF.
- **First open of an existing PDF:** annotations already embedded in it are copied into the JSON once.
- **Refresh:** sends this device's pending changes, pulls the JSON, and applies it to the open viewer.
  No PDF download, no reload; page and zoom stay put. Reading progress is compared too, and a "Go to page N"
  banner appears if the other device is further along.
- The file keeps a capped change log (`log`) – the basis for undo history / restore later – and each
  annotation stores its selected `text` and `note`, ready for cross-volume search.

Shape of `Annotation/<folder>/<name>.json`:

```json
{ "pdfId": "Speeches/Vol-01.pdf", "version": 1, "rev": 17, "lastUpdated": "…",
  "annotations": { "<id>": { "id": "…", "page": 12, "type": "9", "text": "selected text", "note": "my comment",
                             "data": { /* the viewer's own annotation object */ },
                             "created": "…", "modified": "…", "deleted": false } },
  "log": [ { "rev": 17, "op": "upsert", "id": "…", "at": "…" } ] }
```

## API Endpoints

Base URL: `https://library.abhirajbibhar.workers.dev`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/documents` | List all PDFs from R2 |
| GET / HEAD | `/api/documents/:key` | Stream a PDF (ETag, `Range` → `206`, `If-Match` → `412`, `If-None-Match` → `304`) |
| PUT | `/api/documents/:key` | Replace a PDF (keeps backups); honours `If-Match` → `412` on conflict. Not used by the viewer any more |
| GET | `/api/annotations/:key` | Annotations JSON for one PDF (`rev: 0` and empty if none saved yet) |
| PATCH | `/api/annotations/:key` | Body `{ ops: [{op:'upsert',id,page,type,text,note,data} \| {op:'delete',id}] }`; merged by id, returns the new `rev` |
| GET | `/api/metadata/:key` | Reading progress for one PDF |
| PUT | `/api/metadata/:key` | Update reading progress |

Test the API:
```bash
npm run test:api
```

## Metadata Storage

Reading progress lives in one `metadata.json` per folder (`Speeches/metadata.json`, …). The file is
**optional** – it is created automatically the first time you read something in that folder. If you
upload your own, every field except `documents` may be left out:

```json
{
  "version": "1.0",
  "title": "Speeches & Writings",
  "documents": {
    "Speeches/Volume-01.pdf": {
      "lastPage": 42, "totalPages": 256, "lastOpened": "2026-01-15T10:30:00.000Z", "readingTime": 0,
      "view": { "zoom": 1.5, "scrollMode": "horizontal" }
    }
  }
}
```

- `title` (optional) overrides the section heading; otherwise the folder name is shown.
- `view` is saved per document together with progress and restored when the PDF is opened.
  `zoom` is a factor (`1.5` = 150%) or a mode (`automatic`, `fit-page`, `fit-width`) so it adapts to each
  screen; `scrollMode` is `vertical` or `horizontal`. Invalid values are dropped by the worker.

Updates use R2 conditional writes (etag) with retries, so concurrent writers can't silently
overwrite each other, and a corrupt file is never replaced with an empty one.

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Type checking (frontend + worker)
npm run typecheck

# Run the worker locally against a local R2 emulator
npm run dev:worker
```

Configuration: copy `.env.example` to `.env` (API URL, home/logout links, annotation author).

## Deployment

### Quick Start

1. **Create R2 Bucket**
   ```bash
   wrangler r2 bucket create baws
   ```

2. **Upload PDFs**
   - Create any folder(s) you like and upload PDFs into them, e.g. `Speeches/`, `Letters/`
   - Each folder appears in the library as its own section (headed by the folder name). Nothing to
     configure or redeploy when you add a new one. Only one level of folders is read, and folder names
     starting with `_` or `.`, and the name `Annotation`, are reserved.

3. **Deploy Everything**
   ```bash
   npm run deploy
   ```
   This will deploy both the worker and the frontend.

### Available npm Scripts

```bash
npm run dev              # Start development server
npm run build            # Build for production
npm run preview          # Preview production build
npm run deploy:worker    # Deploy Cloudflare Worker only
npm run deploy:pages     # Build and deploy frontend only
npm run deploy           # Deploy both worker and frontend
npm run tail             # View worker logs in real-time
npm run r2:list          # List all files in R2 bucket
npm run r2:upload -- Speeches ./vol1.pdf  # Upload a PDF into a folder (any name; new folder = new section)
npm run test:api         # Test the API endpoint
```

## R2 Bucket Structure

```
baws/
├── <any folder>/            -> becomes a section named after the folder
│   ├── some-book.pdf
│   ├── another-book.pdf
│   └── metadata.json        (optional; progress, view state, optional "title")
├── <another folder>/
│   └── ...
├── Annotation/              (reserved, created automatically: one JSON per PDF, never shown)
│   └── <folder>/<name>.json
└── _versions/               (reserved: automatic backups, never shown)
```

## Self-hosted viewer assets

Nothing is loaded from a CDN at runtime:

- **PDF engine (`pdfium.wasm`)** ships inside the viewer's own dependency (`@embedpdf/pdfium`). The viewer
  loads it from jsDelivr by default, so `src/lib/viewer-assets.ts` imports the file through Vite and passes
  its URL as `wasmUrl`; the build then serves a single hashed copy from `dist/assets/`.
- **Viewer UI font (Open Sans)** is bundled from `@fontsource/open-sans`.
- **PDF fallback fonts are disabled** (`fontFallback: null`). The PDFs embed their own fonts. If you ever add
  a PDF that doesn't, its text falls back to PDFium's built-in substitutes; to host real fallback fonts, see
  the `fontFallback` option of the viewer config.

URLs are configured in `src/lib/viewer-assets.ts`.

## Cost Estimation (Cloudflare Free Tier)

- **Workers**: 100,000 requests/day ✅
- **R2**: 10 GB storage, 1M reads/month, 1M writes/month ✅
- **Pages**: Unlimited bandwidth ✅

For personal use with Babasaheb Ambedkar's writings, this is more than sufficient.

## Features Not Included

- ❌ No file upload (PDFs already in R2)
- ❌ No URL import
- ❌ No local storage
- ❌ No delete functionality (delete directly from R2)
- ❌ No thumbnail generation (shows PDF icon instead)

## Troubleshooting

### "Failed to load library"
- Check worker is deployed: `wrangler deployments list`
- Check R2 bucket exists: `wrangler r2 bucket list`
- Check CORS headers in worker response

### "Failed to load document"
- Verify PDF exists in R2: `wrangler r2 object list baws`
- Check the file path is `<folder>/<name>.pdf` (exactly one folder level, not starting with `_` or `.`)
- Check worker logs: `wrangler tail`

### "Failed to save"
- Check worker has write access to R2
- Verify PDF is valid
- Check network connection

## License

MIT

## Author

Built for reading Babasaheb Dr. B.R. Ambedkar's Writings and Speeches.
