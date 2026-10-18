import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLibrary } from '../hooks/useLibrary';
import { useDocActions } from '../hooks/useDocActions';
import { allTags, countByFilter, filterDocs, groupByFolder, sortDocs, type DocFilter, type DocSort } from '../lib/docs';
import { folderPath, plural } from '../lib/format';
import BookCover from '../components/BookCover';
import { Icon } from '../components/Icon';
import Menu from '../components/Menu';
import ViewMenu from '../components/ViewMenu';
import { Notice, PageHeader, PageShell, SearchField, Spinner } from '../components/PageShell';

/** Explore Library: every folder is a shelf of books you can scroll sideways. */
export default function LibraryPage() {
  const { documents, loaded, error, loading, reload } = useLibrary();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const focusSearch = params.has('search');
  const [filter, setFilter] = useState<DocFilter>('all');
  const [sort, setSort] = useState<DocSort>('recent');
  const [tag, setTag] = useState('');
  const { menuForDoc, menuForFolder, dialog } = useDocActions(documents, () => void reload(true));

  const setQuery = (q: string) => setParams(q ? { q } : focusSearch ? { search: '1' } : {}, { replace: true });

  const counts = useMemo(() => countByFilter(documents), [documents]);
  const shelves = useMemo(
    () => groupByFolder(filterDocs(documents, query, filter, tag)).map((s) => ({ ...s, docs: sortDocs(s.docs, sort) })),
    [documents, query, filter, tag, sort],
  );
  const tags = useMemo(() => allTags(documents), [documents]);
  const folderCount = useMemo(() => new Set(documents.map((d) => d.folder)).size, [documents]);

  return (
    <PageShell>
      <PageHeader
        title="Explore Library"
        backTo="/"
        backLabel="Back to Home"
        subtitle={loaded ? `${plural(documents.length, 'document')} on ${plural(folderCount, 'shelf', 'shelves')}` : undefined}
        actions={<Link to="/upload" className="btn-plain focus-ring" aria-label="Add to Library" title="Add to Library"><Icon name="plus" /></Link>}
      />

      <div className="flex items-center gap-3">
        <SearchField className="min-w-0 flex-1" value={query} onChange={setQuery} placeholder="Search all shelves" autoFocus={focusSearch} />
        <ViewMenu filter={filter} onFilter={setFilter} sort={sort} onSort={setSort} counts={counts} tags={tags} tag={tag} onTag={setTag} />
      </div>

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
            <div className="mb-2 flex items-center gap-2">
              <Link to={folderPath(shelf.folder)} className="focus-ring group flex min-h-11 min-w-0 items-baseline gap-3">
                <h2 className="truncate text-lg font-bold tracking-tight group-hover:underline">{shelf.title}</h2>
                <span className="mute shrink-0">{shelf.docs.length}</span>
              </Link>
              <div className="ml-auto flex">
                <Link to={folderPath(shelf.folder)} className="btn-plain focus-ring" aria-label={`Open ${shelf.title}`} title="Open folder"><Icon name="arrow" /></Link>
                <Menu label={`Options for ${shelf.title}`} entries={menuForFolder(shelf.folder, shelf.title, documents.filter((d) => d.folder === shelf.folder))} />
              </div>
            </div>
            <div className="-mx-1 flex snap-x snap-proximity gap-4 overflow-x-auto px-1 pb-3 pt-1">
              {shelf.docs.slice(0, 12).map((d) => (
                <BookCover key={d.id} doc={d} menu={menuForDoc(d)} className="w-[150px] shrink-0 snap-start md:w-[180px]" />
              ))}
            </div>
          </section>
        ))
      )}
      {dialog}
    </PageShell>
  );
}
