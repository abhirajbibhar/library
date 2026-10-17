import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLibrary } from '../hooks/useLibrary';
import { countByFilter, filterDocs, FILTER_LABELS, FILTERS, sortDocs, type DocFilter, type DocSort } from '../lib/docs';
import { coverColor, formatDay, formatSize, plural, progressLabel, progressPct, viewerPath } from '../lib/format';
import BookCover from '../components/BookCover';
import { Icon } from '../components/Icon';
import { FilterChips, Notice, PageHeader, PageShell, SearchField, SelectField, Spinner } from '../components/PageShell';

const PAGE_SIZE = 24;
const SORT_OPTIONS: { value: DocSort; label: string }[] = [
  { value: 'recent', label: 'Recently opened' },
  { value: 'title', label: 'Title' },
  { value: 'progress', label: 'Progress' },
];

/** One folder (shelf): summary, search / sort / filters and every document as a grid or list. */
export default function FolderPage() {
  const { name = '' } = useParams<{ name: string }>();
  const { documents, loaded, error, loading, reload } = useLibrary();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DocFilter>('all');
  const [sort, setSort] = useState<DocSort>('recent');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [shown, setShown] = useState(PAGE_SIZE);

  const docs = useMemo(() => documents.filter((d) => d.folder === name), [documents, name]);
  const title = docs[0]?.folderTitle || name;
  const counts = useMemo(() => countByFilter(docs), [docs]);
  const visible = useMemo(() => sortDocs(filterDocs(docs, query, filter), sort), [docs, query, filter, sort]);

  const opened = docs.filter((d) => d.totalPages > 0);
  const pagesRead = opened.reduce((n, d) => n + d.lastPage, 0);
  const pagesKnown = opened.reduce((n, d) => n + d.totalPages, 0);
  const pct = pagesKnown ? Math.min(100, Math.round((pagesRead / pagesKnown) * 100)) : 0;

  const reset = () => setShown(PAGE_SIZE);

  return (
    <PageShell>
      <PageHeader
        title={title}
        backTo="/library"
        backLabel="Back to Library"
        subtitle={
          <>
            <Link to="/library" className="underline">Library</Link> / {title}
          </>
        }
        actions={
          <Link to={`/upload?folder=${encodeURIComponent(name)}`} className="btn-ghost btn-sq focus-ring" aria-label={`Add to ${title}`} title={`Add to ${title}`}>
            <Icon name="upload" />
          </Link>
        }
      />

      {error && !loaded ? (
        <Notice tone="error" title="Couldn’t load this folder" action={<button className="btn-primary" onClick={() => void reload()}>Try again</button>}>
          Please check your connection.
        </Notice>
      ) : !loaded && loading ? (
        <Spinner />
      ) : docs.length === 0 ? (
        <Notice title="This folder is empty or doesn’t exist" action={<Link to="/library" className="btn-ghost">Back to Library</Link>}>
          Folders appear once they hold at least one PDF.
        </Notice>
      ) : (
        <>
          <section className="card flex flex-wrap items-center gap-x-8 gap-y-5">
            <div className="min-w-[240px] flex-[2]">
              <div className="mb-2.5 flex justify-between gap-3 font-bold">
                <span>{pct}% read</span>
                <span className="mute font-normal">{pagesRead.toLocaleString()} of {pagesKnown.toLocaleString()} pages</span>
              </div>
              <div className="track"><span style={{ width: `${pct}%` }} /></div>
            </div>
            <div className="flex min-w-[260px] flex-[3] gap-4">
              {[
                ['Finished', counts.done],
                ['In progress', counts.reading],
                ['Not started', counts.new],
              ].map(([label, n]) => (
                <div key={label} className="min-w-[90px] flex-1">
                  <b className="block text-[26px]">{n}</b>
                  <span className="mute">{label}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <SearchField className="min-w-[240px] flex-1" value={query} onChange={(v) => { setQuery(v); reset(); }} placeholder={`Search in ${title}`} />
            <div className="flex w-full gap-3 sm:w-auto">
              <SelectField className="flex-1 sm:flex-none" label="Sort" value={sort} onChange={(v) => { setSort(v); reset(); }} options={SORT_OPTIONS} />
              {(['grid', 'list'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`btn-ghost btn-sq focus-ring ${view === v ? 'bg-indigo-50! dark:bg-indigo-950/60!' : ''}`}
                  aria-pressed={view === v}
                  aria-label={v === 'grid' ? 'Grid view' : 'List view'}
                  onClick={() => setView(v)}
                >
                  <Icon name={v} />
                </button>
              ))}
            </div>
          </div>

          <FilterChips
            value={filter}
            onChange={(f) => { setFilter(f); reset(); }}
            options={FILTERS.map((f) => ({ value: f, label: FILTER_LABELS[f], count: counts[f] }))}
          />

          {visible.length === 0 ? (
            <Notice title="No documents match">Try a different search or filter.</Notice>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {visible.slice(0, shown).map((d) => <BookCover key={d.id} doc={d} />)}
            </div>
          ) : (
            <ul className="card p-0">
              {visible.slice(0, shown).map((d, i) => (
                <li key={d.id} className={i ? 'border-t border-gray-200 dark:border-gray-700' : ''}>
                  <Link to={viewerPath(d.id)} className="focus-ring flex items-center gap-4 p-4 hover:opacity-85">
                    <span className="h-12 w-9 shrink-0 rounded-md" style={{ backgroundColor: coverColor(d.name) }} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{d.name}</div>
                      <div className="mute">{progressLabel(d)} · {formatSize(d.size)}{d.lastOpened ? ` · ${formatDay(d.lastOpened)}` : ''}</div>
                    </div>
                    <div className="track hidden w-24 sm:block"><span style={{ width: `${progressPct(d)}%` }} /></div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {visible.length > 0 && (
            <div className="mt-2 flex flex-col items-center gap-3">
              <span className="mute">Showing {Math.min(shown, visible.length)} of {plural(visible.length, 'document')}</span>
              {shown < visible.length && (
                <button type="button" className="btn-ghost min-w-[180px] focus-ring" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                  Load more
                </button>
              )}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
