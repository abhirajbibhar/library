import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLibrary } from '../hooks/useLibrary';
import { useDocActions } from '../hooks/useDocActions';
import { allTags, countByFilter, filterDocs, sortDocs, type DocFilter, type DocSort } from '../lib/docs';
import { coverColor, formatDay, formatSize, plural, progressLabel, viewerPath } from '../lib/format';
import BookCover from '../components/BookCover';
import { Icon } from '../components/Icon';
import Menu from '../components/Menu';
import ViewMenu from '../components/ViewMenu';
import { Notice, PageHeader, PageShell, SearchField, Spinner } from '../components/PageShell';

const PAGE_SIZE = 24;

/** One folder (shelf): search, filter and sort, with every document as a grid or a list. */
export default function FolderPage() {
  const { name = '' } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { documents, loaded, error, loading, reload } = useLibrary();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DocFilter>('all');
  const [sort, setSort] = useState<DocSort>('recent');
  const [tag, setTag] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [shown, setShown] = useState(PAGE_SIZE);

  const docs = useMemo(() => documents.filter((d) => d.folder === name), [documents, name]);
  const title = docs[0]?.folderTitle || name;
  const counts = useMemo(() => countByFilter(docs), [docs]);
  const visible = useMemo(() => sortDocs(filterDocs(docs, query, filter, tag), sort), [docs, query, filter, tag, sort]);
  const tags = useMemo(() => allTags(docs), [docs]);
  const reset = () => setShown(PAGE_SIZE);

  const { menuForDoc, menuForFolder, dialog } = useDocActions(documents, (c) => {
    if (c.kind === 'folder-removed' || (c.kind === 'doc-removed' && docs.length <= 1)) navigate('/library', { replace: true });
    else if (c.kind === 'folder-renamed') navigate(`/folder/${encodeURIComponent(c.to)}`, { replace: true });
    else void reload(true);
  });

  return (
    <PageShell>
      <PageHeader
        title={title}
        backTo="/library"
        backLabel="Back to Library"
        subtitle={loaded && docs.length ? `${plural(docs.length, 'document')} · ${counts.done} finished · ${counts.reading} in progress` : undefined}
        actions={
          <>
            <Link to={`/upload?folder=${encodeURIComponent(name)}`} className="btn-plain focus-ring" aria-label={`Add to ${title}`} title="Add files"><Icon name="plus" /></Link>
            {docs.length > 0 && <Menu label="Folder options" entries={menuForFolder(name, title, docs)} />}
          </>
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
          <div className="flex items-center gap-3">
            <SearchField className="min-w-0 flex-1" value={query} onChange={(v) => { setQuery(v); reset(); }} placeholder={`Search in ${title}`} />
            <ViewMenu filter={filter} onFilter={(f) => { setFilter(f); reset(); }} sort={sort} onSort={(s) => { setSort(s); reset(); }} counts={counts} tags={tags} tag={tag} onTag={(t) => { setTag(t); reset(); }} />
            <button
              type="button"
              className="btn-ghost btn-sq focus-ring"
              aria-label={view === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
              title={view === 'grid' ? 'List view' : 'Grid view'}
              onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
            >
              <Icon name={view === 'grid' ? 'list' : 'grid'} />
            </button>
          </div>

          {visible.length === 0 ? (
            <Notice title="No documents match">Try a different search or filter.</Notice>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {visible.slice(0, shown).map((d) => <BookCover key={d.id} doc={d} menu={menuForDoc(d)} />)}
            </div>
          ) : (
            <ul className="card p-0">
              {visible.slice(0, shown).map((d, i) => (
                <li key={d.id} className={`flex items-center gap-2 pr-2 ${i ? 'border-t border-gray-100 dark:border-gray-700/60' : ''}`}>
                  <Link to={viewerPath(d.id)} className="focus-ring flex min-w-0 flex-1 items-center gap-4 p-4 hover:opacity-85">
                    <span className="h-12 w-9 shrink-0 rounded-md" style={{ backgroundColor: coverColor(d.name) }} aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{d.name}</div>
                      <div className="mute truncate">{progressLabel(d)} · {formatSize(d.size)}{d.lastOpened ? ` · ${formatDay(d.lastOpened)}` : ''}{d.tags.length ? ` · ${d.tags.join(', ')}` : ''}</div>
                    </div>
                  </Link>
                  <Menu label={`Options for ${d.name}`} entries={menuForDoc(d)} />
                </li>
              ))}
            </ul>
          )}

          {visible.length > shown && (
            <div className="flex flex-col items-center gap-3">
              <span className="mute">Showing {shown} of {visible.length}</span>
              <button type="button" className="btn-ghost min-w-[180px] focus-ring" onClick={() => setShown((n) => n + PAGE_SIZE)}>Load more</button>
            </div>
          )}
        </>
      )}
      {dialog}
    </PageShell>
  );
}
