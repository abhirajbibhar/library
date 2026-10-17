import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AnnotationSummary, PdfDocument, StorageOverview } from '../types';
import { getAllAnnotations, getStorage } from '../lib/db';
import { LOGOUT_URL } from '../config';
import { useTheme } from '../contexts/ThemeContext';
import { useFetch } from '../hooks/useFetch';
import { useLibrary } from '../hooks/useLibrary';
import { coverColor, formatDay, formatSize, isFinished, plural, progressLabel, progressPct, viewerPath } from '../lib/format';
import { Icon, PlayIcon } from '../components/Icon';
import Menu, { type MenuEntry } from '../components/Menu';
import { Notice, PageHeader, PageShell, Spinner } from '../components/PageShell';

const DAY = 86_400_000;
const DEFAULT_HIGHLIGHT = '#f5b700';

export default function HomePage() {
  const { documents, loaded, error, reload, loading } = useLibrary();
  const annotations = useFetch(() => getAllAnnotations());
  const storage = useFetch(() => getStorage());
  const { theme, toggleTheme } = useTheme();

  const current = useMemo(
    () =>
      documents
        .filter((d) => d.lastOpened && d.totalPages > 0 && !isFinished(d))
        .sort((a, b) => Date.parse(b.lastOpened!) - Date.parse(a.lastOpened!))[0],
    [documents],
  );

  const menu: MenuEntry[] = [
    { label: 'Annotations', icon: 'pen', to: '/annotations' },
    { label: 'Add to Library', icon: 'upload', to: '/upload' },
    { heading: 'Appearance' },
    { label: theme === 'light' ? 'Dark mode' : 'Light mode', icon: theme === 'light' ? 'moon' : 'sun', onSelect: toggleTheme },
    { heading: 'Account' },
    { label: 'Log out', icon: 'logout', href: LOGOUT_URL },
  ];

  return (
    <PageShell>
      <PageHeader
        title="My Library"
        subtitle={<span lang="or" style={{ fontFamily: "'Noto Sans Oriya', 'Noto Sans', system-ui, sans-serif", fontSize: 15 }}>ଅଜ୍ଝତ୍ତଂ ଏବ ମଗ୍ଗୋ’ତି</span>}
        actions={
          <>
            <Link to="/library?search=1" className="btn-plain focus-ring" aria-label="Search" title="Search"><Icon name="search" /></Link>
            <Link to="/upload" className="btn-plain focus-ring" aria-label="Add to Library" title="Add to Library"><Icon name="plus" /></Link>
            <Menu label="More" entries={menu} />
          </>
        }
      />

      {error && !loaded ? (
        <Notice tone="error" title="Couldn’t load your library" action={<button className="btn-primary" onClick={() => void reload()}>Try again</button>}>
          Please check your connection.
        </Notice>
      ) : !loaded && loading ? (
        <Spinner />
      ) : (
        <>
          <ContinueReading doc={current} empty={documents.length === 0} />
          <DailyQuote items={annotations.data} />
          <div className="grid items-start gap-6 md:grid-cols-2">
            <RecentlyOpened documents={documents} />
            <LatestAnnotations items={annotations.data} />
          </div>
          <Footer documents={documents} annotations={annotations.data} storage={storage.data} />
        </>
      )}
    </PageShell>
  );
}

function ContinueReading({ doc, empty }: { doc?: PdfDocument; empty: boolean }) {
  return (
    <section className="card flex items-center gap-7 p-6 sm:p-8">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="mute font-semibold">{doc ? 'Continue reading' : 'Welcome'}</div>
        {doc ? (
          <>
            <h2 className="text-2xl font-bold leading-tight tracking-tight sm:text-[28px]">{doc.name}</h2>
            <div className="mute">{doc.folderTitle} · {progressLabel(doc)} · opened {formatDay(doc.lastOpened).toLowerCase()}</div>
            <div className="track max-w-[420px]" role="img" aria-label={`${progressPct(doc)} percent read`}><span style={{ width: `${progressPct(doc)}%` }} /></div>
          </>
        ) : (
          <h2 className="text-2xl font-bold leading-tight tracking-tight">{empty ? 'Your library is empty' : 'Pick something to read'}</h2>
        )}
        <div className="mt-2 flex gap-3">
          {doc && (
            <Link to={viewerPath(doc.id, doc.lastPage)} className="btn-primary btn-sq focus-ring" aria-label={`Resume reading at page ${doc.lastPage}`} title="Resume">
              <PlayIcon />
            </Link>
          )}
          <Link to={empty ? '/upload' : '/library'} className="btn-ghost focus-ring min-w-0 flex-1 sm:flex-none">
            {empty ? 'Add your first book' : 'Explore Library'}
          </Link>
        </div>
      </div>
      {doc && (
        <div
          className="hidden h-[184px] w-[138px] shrink-0 flex-col justify-end rounded-xl p-4 text-white shadow-lg shadow-slate-900/20 sm:flex"
          style={{ backgroundColor: coverColor(doc.name) }}
          aria-hidden="true"
        >
          <div className="line-clamp-4 text-base font-bold leading-snug">{doc.name}</div>
        </div>
      )}
    </section>
  );
}

function DailyQuote({ items }: { items: AnnotationSummary[] | null }) {
  const highlights = useMemo(() => (items ?? []).filter((a) => a.text.trim()), [items]);
  const [offset, setOffset] = useState(0);
  if (highlights.length === 0) return null;
  const pick = highlights[(Math.floor(Date.now() / DAY) + offset) % highlights.length];

  return (
    <section aria-label="Daily quote" className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-2 py-4 text-center">
      <blockquote className="text-xl font-medium leading-relaxed sm:text-2xl">“{pick.text.trim()}”</blockquote>
      <div className="mute">{pick.docName} · page {pick.page}</div>
      <div className="flex gap-1">
        <Link to={viewerPath(pick.docId, pick.page)} className="btn-plain focus-ring" aria-label="Open in document" title="Open in document"><Icon name="book" className="h-5 w-5" /></Link>
        <button type="button" className="btn-plain focus-ring disabled:opacity-40" aria-label="Show another quote" title="Another quote" onClick={() => setOffset((o) => o + 1)} disabled={highlights.length < 2}>
          <Icon name="refresh" className="h-5 w-5" />
        </button>
      </div>
    </section>
  );
}

function SectionTitle({ children, to, label }: { children: string; to?: string; label?: string }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-3">
      <h2 className="text-base font-bold">{children}</h2>
      {to && (
        <Link to={to} className="btn-plain focus-ring -mr-2" aria-label={label} title={label}><Icon name="arrow" /></Link>
      )}
    </div>
  );
}

function RecentlyOpened({ documents }: { documents: PdfDocument[] }) {
  const recent = useMemo(
    () => documents.filter((d) => d.lastOpened).sort((a, b) => Date.parse(b.lastOpened!) - Date.parse(a.lastOpened!)).slice(0, 4),
    [documents],
  );
  return (
    <div className="card">
      <SectionTitle to="/library" label="Explore Library">Recently opened</SectionTitle>
      {recent.length === 0 ? (
        <p className="mute py-3">Nothing opened yet.</p>
      ) : (
        <ul>
          {recent.map((d, i) => (
            <li key={d.id} className={i ? 'border-t border-gray-100 dark:border-gray-700/60' : ''}>
              <Link to={viewerPath(d.id, d.lastPage)} className="focus-ring flex items-center gap-3 py-3 hover:opacity-85">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{d.name}</div>
                  <div className="mute truncate">{d.folderTitle} · {progressLabel(d)}</div>
                </div>
                <span className="mute shrink-0">{formatDay(d.lastOpened)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LatestAnnotations({ items }: { items: AnnotationSummary[] | null }) {
  const latest = (items ?? []).slice(0, 4);
  return (
    <div className="card">
      <SectionTitle to="/annotations" label="All annotations">Latest annotations</SectionTitle>
      {latest.length === 0 ? (
        <p className="mute py-3">Highlights and notes you add while reading will appear here.</p>
      ) : (
        <ul>
          {latest.map((a, i) => (
            <li key={`${a.docId}:${a.id}`} className={i ? 'border-t border-gray-100 dark:border-gray-700/60' : ''}>
              <Link to={viewerPath(a.docId, a.page)} className="focus-ring flex items-start gap-3 py-3 hover:opacity-85">
                <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: a.text ? a.color ?? DEFAULT_HIGHLIGHT : '#6366f1' }} />
                <div className="min-w-0">
                  <div className="line-clamp-2 font-semibold">{a.note || a.text || 'Annotation'}</div>
                  <div className="mute truncate">{a.docName} · page {a.page}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One quiet line of totals; Storage opens a small breakdown instead of taking up a card. */
function Footer({ documents, annotations, storage }: { documents: PdfDocument[]; annotations: AnnotationSummary[] | null; storage: StorageOverview | null }) {
  const folders = new Set(documents.map((d) => d.folder)).size;
  const finished = documents.filter(isFinished).length;
  const rows: MenuEntry[] = storage
    ? [
        { heading: 'Storage used' },
        ...storage.folders.map((f) => ({ label: f.name, meta: formatSize(f.size) })),
        { label: 'Backups and annotations', meta: formatSize(storage.backups + storage.annotations + storage.other) },
      ]
    : [{ label: 'Storage usage is unavailable' }];
  return (
    <footer className="mute flex flex-wrap items-center justify-center gap-x-1 gap-y-0 pt-2">
      <span className="px-2">{plural(documents.length, 'document')} in {plural(folders, 'folder')}</span>
      <span aria-hidden="true">·</span>
      <span className="px-2">{finished} finished</span>
      <span aria-hidden="true">·</span>
      <Link to="/annotations" className="focus-ring inline-flex min-h-11 items-center px-2 underline">{annotations ? plural(annotations.length, 'annotation') : 'Annotations'}</Link>
      {storage && (
        <>
          <span aria-hidden="true">·</span>
          <Menu
            label="Storage breakdown"
            entries={rows}
            align="left"
            buttonClassName="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-[13px] text-gray-500 underline hover:bg-gray-200/70 dark:text-gray-400 dark:hover:bg-gray-700"
            trigger={<><Icon name="disk" className="h-4 w-4" />{formatSize(storage.total)} used</>}
          />
        </>
      )}
    </footer>
  );
}
