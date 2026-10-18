import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AnnotationSummary, PdfDocument, ReadingStats, StorageOverview } from '../types';
import { getAllAnnotations, getReading, getStorage, setReadingGoal } from '../lib/db';
import { LOGOUT_URL } from '../config';
import { useTheme } from '../contexts/ThemeContext';
import { useFetch } from '../hooks/useFetch';
import { useLibrary } from '../hooks/useLibrary';
import { useDocActions } from '../hooks/useDocActions';
import { coverColor, formatDay, formatDuration, formatSize, isFinished, localDay, plural, progressLabel, progressPct, readingStreak, viewerPath } from '../lib/format';
import BookCover from '../components/BookCover';
import { Icon, PlayIcon } from '../components/Icon';
import Menu, { type MenuEntry } from '../components/Menu';
import { Notice, PageHeader, PageShell, Spinner } from '../components/PageShell';

const DAY = 86_400_000;
const DEFAULT_HIGHLIGHT = '#f5b700';

export default function HomePage() {
  const { documents, loaded, error, reload, loading } = useLibrary();
  const annotations = useFetch(() => getAllAnnotations());
  const storage = useFetch(() => getStorage());
  const reading = useFetch(() => getReading());
  const { menuForDoc, dialog } = useDocActions(documents, () => void reload(true));
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
    { label: 'Trash', icon: 'trash', to: '/trash' },
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
          <Stats documents={documents} annotations={annotations.data} />
          <DailyQuote items={annotations.data} />
          <Favourites docs={documents.filter((d) => d.favorite)} menuFor={menuForDoc} />
          <div className="grid items-start gap-6 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-6">
              <StorageCard storage={storage.data} failed={!!storage.error} />
              <ReadingChart stats={reading.data} onGoal={(m) => void setReadingGoal(m).then(() => reading.reload(true))} />
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <RecentlyOpened documents={documents} />
              <LatestAnnotations items={annotations.data} />
            </div>
          </div>
        </>
      )}
      {dialog}
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

function Stats({ documents, annotations }: { documents: PdfDocument[]; annotations: AnnotationSummary[] | null }) {
  const folders = new Set(documents.map((d) => d.folder)).size;
  const opened = documents.filter((d) => d.totalPages > 0);
  const pagesRead = opened.reduce((n, d) => n + d.lastPage, 0);
  const pagesKnown = opened.reduce((n, d) => n + d.totalPages, 0);
  const finished = documents.filter(isFinished).length;
  const cards = [
    { label: 'Documents', value: documents.length.toLocaleString(), sub: `in ${plural(folders, 'folder')}` },
    { label: 'Pages read', value: pagesRead.toLocaleString(), sub: `of ${pagesKnown.toLocaleString()} in opened books` },
    { label: 'Finished', value: finished.toLocaleString(), sub: `${opened.length - finished} in progress` },
    { label: 'Annotations', value: annotations ? annotations.length.toLocaleString() : '–', sub: 'highlights and notes', to: '/annotations' },
  ];
  return (
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((c) => {
        const body = (
          <>
            <div className="mute">{c.label}</div>
            <div className="mt-1 text-3xl font-bold tracking-tight">{c.value}</div>
            <div className="mute">{c.sub}</div>
          </>
        );
        return c.to ? (
          <Link key={c.label} to={c.to} className="card focus-ring transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/60">{body}</Link>
        ) : (
          <div key={c.label} className="card">{body}</div>
        );
      })}
    </section>
  );
}

function StorageCard({ storage, failed }: { storage: StorageOverview | null; failed: boolean }) {
  const rows = storage
    ? [
        ...storage.folders.map((f) => ({ name: f.name, size: f.size })),
        { name: 'Backups and annotations', size: storage.backups + storage.annotations + storage.other },
      ]
    : [];
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-bold"><Icon name="disk" className="h-[18px] w-[18px] text-gray-500 dark:text-gray-400" />Storage</h2>
        <span className="mute">Cloudflare R2</span>
      </div>
      {storage ? (
        <>
          <div className="mb-3.5 mt-3 flex flex-wrap items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight">{formatSize(storage.total)}</span>
            <span className="mute">used</span>
          </div>
          <ul>
            {rows.map((r) => (
              <li key={r.name} className="flex items-center gap-3 border-t border-gray-100 py-2.5 dark:border-gray-700/60">
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <b className="mute font-semibold">{formatSize(r.size)}</b>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mute mt-3">{failed ? 'Storage usage is unavailable right now.' : 'Calculating…'}</p>
      )}
    </div>
  );
}

const GOALS = [0, 10, 20, 30, 60];

function ReadingChart({ stats, onGoal }: { stats: ReadingStats | null; onGoal: (minutes: number) => void }) {
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), seconds: stats?.days[localDay(d)] ?? 0 };
      }),
    [stats],
  );
  const goal = stats?.goalMinutes ?? 0;
  const total = days.reduce((n, d) => n + d.seconds, 0);
  const today = days[6].seconds;
  const streak = stats ? readingStreak(stats.days) : 0;
  const max = Math.max(60, goal * 60, ...days.map((d) => d.seconds));
  const summary = days.map((d) => `${d.label} ${formatDuration(d.seconds)}`).join(', ');

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold">Reading time</h2>
        <Menu
          label="Daily goal"
          icon="sliders"
          entries={[
            { heading: 'Daily goal' },
            ...GOALS.map((g): MenuEntry => ({ label: g ? `${g} minutes` : 'No goal', checked: goal === g, onSelect: () => onGoal(g) })),
          ]}
        />
      </div>
      <div className="mute mb-3.5">
        {formatDuration(total)} this week{streak > 0 ? ` · ${plural(streak, 'day')} in a row` : ''}
        {goal > 0 ? ` · today ${formatDuration(today)} of ${goal}m` : ''}
      </div>
      <div role="img" aria-label={`Reading time per day: ${summary}`} className="flex h-[140px] items-end gap-3">
        {days.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end text-center">
            {d.seconds >= 60 && <span className="mute mb-1">{formatDuration(d.seconds)}</span>}
            <div
              className={`w-full rounded-t-lg ${d.seconds >= 60 ? 'bg-indigo-600 dark:bg-indigo-400' : 'bg-gray-200 dark:bg-gray-700'}`}
              style={{ height: d.seconds >= 60 ? `${Math.max(10, (d.seconds / max) * 90)}px` : '4px' }}
            />
            <div className="mute mt-1.5">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Favourites({ docs, menuFor }: { docs: PdfDocument[]; menuFor: (d: PdfDocument) => MenuEntry[] }) {
  if (docs.length === 0) return null;
  return (
    <section aria-label="Favourites">
      <h2 className="mb-2 flex items-center gap-2 text-base font-bold"><Icon name="star" className="h-[18px] w-[18px]" />Favourites</h2>
      <div className="-mx-1 flex snap-x snap-proximity gap-4 overflow-x-auto px-1 pb-2 pt-1">
        {docs.map((d) => (
          <BookCover key={d.id} doc={d} menu={menuFor(d)} className="w-[132px] shrink-0 snap-start md:w-[150px]" />
        ))}
      </div>
    </section>
  );
}
