import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLibrary } from '../hooks/useLibrary';
import { countByFilter, filterDocs, FILTER_LABELS, FILTERS, groupByFolder, sortDocs, type DocFilter, type DocSort } from '../lib/docs';
import { folderPath, plural } from '../lib/format';
import BookCover from '../components/BookCover';
import { Icon } from '../components/Icon';
import { FilterChips, Notice, PageHeader, PageShell, SearchField, SelectField, Spinner } from '../components/PageShell';

const SORT_OPTIONS: { value: DocSort; label: string }[] = [
  { value: 'recent', label: 'Recently opened' },
  { value: 'title', label: 'Title' },
  { value: 'progress', label: 'Progress' },
];

/** Explore Library: every folder is a shelf of books you can scroll sideways. */
export default function LibraryPage() {
  const { documents, loaded, error, loading, reload } = useLibrary();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [filter, setFilter] = useState<DocFilter>('all');
  const [sort, setSort] = useState<DocSort>('recent');

  const setQuery = (q: string) => setParams(q ? { q } : {}, { replace: true });

  const counts = useMemo(() => countByFilter(documents), [documents]);
  const shelves = useMemo(
    () =>
      groupByFolder(filterDocs(documents, query, filter)).map((s) => ({ ...s, docs: sortDocs(s.docs, sort) })),
    [documents, query, filter, sort],
  );
  const folderCount = useMemo(() => new Set(documents.map((d) => d.folder)).size, [documents]);

  return (
    <PageShell>
      <PageHeader
        title="Explore Library"
        backTo="/"
        backLabel="Back to Home"
        subtitle={loaded ? `${plural(documents.length, 'document')} on ${plural(folderCount, 'shelf', 'shelves')}` : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchField className="min-w-[240px] flex-1" value={query} onChange={setQuery} placeholder="Search all shelves" />
        <SelectField className="w-full sm:w-auto" label="Sort" value={sort} onChange={setSort} options={SORT_OPTIONS} />
      </div>
      <FilterChips
        value={filter}
        onChange={setFilter}
        options={FILTERS.map((f) => ({ value: f, label: FILTER_LABELS[f], count: counts[f] }))}
      />

      {error && !loaded ? (
        <Notice tone="error" title="Couldn’t load your library" action={<button className="btn-primary" onClick={() => void reload()}>Try again</button>}>
          Please check your connection.
        </Notice>
      ) : !loaded && loading ? (
        <Spinner />
      ) : documents.length === 0 ? (
        <Notice title="Your library is empty" action={<Link to="/upload" className="btn-primary">Add your first book</Link>}>
          Upload a PDF and choose a folder. Each folder becomes a shelf here.
        </Notice>
      ) : shelves.length === 0 ? (
        <Notice title="No documents match">Try a different search or filter.</Notice>
      ) : (
        shelves.map((shelf) => (
          <section key={shelf.folder} aria-label={shelf.title}>
            <div className="mb-3.5 flex items-baseline gap-3">
              <h2 className="text-lg font-bold">{shelf.title}</h2>
              <span className="mute">{plural(shelf.docs.length, 'document')}</span>
              <Link to={folderPath(shelf.folder)} className="focus-ring ml-auto inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold underline">
                See all <Icon name="arrow" className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="-mx-1 flex snap-x snap-proximity gap-4 overflow-x-auto px-1 pb-3.5 pt-1">
              {shelf.docs.slice(0, 12).map((d) => (
                <BookCover key={d.id} doc={d} className="w-[150px] shrink-0 snap-start md:w-[180px]" />
              ))}
            </div>
            <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700" />
          </section>
        ))
      )}
    </PageShell>
  );
}
