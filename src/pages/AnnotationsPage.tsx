import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AnnotationSummary } from '../types';
import { getAllAnnotations } from '../lib/db';
import { useFetch } from '../hooks/useFetch';
import { coverColor, formatDay, plural, viewerPath } from '../lib/format';
import { Icon } from '../components/Icon';
import Menu, { type MenuEntry } from '../components/Menu';
import { Notice, PageHeader, PageShell, SearchField, Spinner } from '../components/PageShell';

type Kind = 'all' | 'highlight' | 'note';
type Sort = 'newest' | 'oldest' | 'document';

const PAGE_SIZE = 30;
const DEFAULT_COLOR = '#f5b700';
const NOTE_COLOR = '#6366f1';

const kindOf = (a: AnnotationSummary): 'highlight' | 'note' => (a.text.trim() ? 'highlight' : 'note');
/** "#rrggbb" -> translucent tint (works on light and dark cards). */
const tint = (hex: string | null) => `${hex ?? DEFAULT_COLOR}40`;
const when = (a: AnnotationSummary) => Date.parse(a.modified || a.created) || 0;

/** Every highlight and note across the library, grouped by document. */
export default function AnnotationsPage() {
  const { data, error, loading, reload } = useFetch(() => getAllAnnotations());
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [doc, setDoc] = useState('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [shown, setShown] = useState(PAGE_SIZE);

  const items = useMemo(() => data ?? [], [data]);
  const stats = useMemo(() => {
    const highlights = items.filter((a) => kindOf(a) === 'highlight').length;
    return { total: items.length, highlights, notes: items.length - highlights, documents: new Set(items.map((a) => a.docId)).size };
  }, [items]);
  const docOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const a of items) names.set(a.docId, a.docName);
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = items.filter(
      (a) =>
        (kind === 'all' || kindOf(a) === kind) &&
        (doc === 'all' || a.docId === doc) &&
        (!q || `${a.text} ${a.note} ${a.docName}`.toLowerCase().includes(q)),
    );
    if (sort === 'oldest') out.sort((a, b) => when(a) - when(b));
    else if (sort === 'document') out.sort((a, b) => a.docName.localeCompare(b.docName, undefined, { numeric: true }) || a.page - b.page);
    else out.sort((a, b) => when(b) - when(a));
    return out;
  }, [items, query, kind, doc, sort]);

  // Group the visible slice by document, keeping the order the sort produced.
  const groups = useMemo(() => {
    const map = new Map<string, { docId: string; docName: string; folder: string; list: AnnotationSummary[] }>();
    for (const a of filtered.slice(0, shown)) {
      const g = map.get(a.docId) ?? { docId: a.docId, docName: a.docName, folder: a.folder, list: [] };
      g.list.push(a);
      map.set(a.docId, g);
    }
    return [...map.values()];
  }, [filtered, shown]);

  const reset = () => setShown(PAGE_SIZE);

  const pick = <T,>(set: (v: T) => void, v: T) => () => {
    set(v);
    reset();
  };
  const viewEntries: MenuEntry[] = [
    { heading: 'Show' },
    { label: `All (${stats.total})`, checked: kind === 'all', keepOpen: true, onSelect: pick(setKind, 'all') },
    { label: `Highlights (${stats.highlights})`, checked: kind === 'highlight', keepOpen: true, onSelect: pick(setKind, 'highlight') },
    { label: `Notes (${stats.notes})`, checked: kind === 'note', keepOpen: true, onSelect: pick(setKind, 'note') },
    { heading: 'Sort by' },
    { label: 'Newest first', checked: sort === 'newest', keepOpen: true, onSelect: pick(setSort, 'newest') },
    { label: 'Oldest first', checked: sort === 'oldest', keepOpen: true, onSelect: pick(setSort, 'oldest') },
    { label: 'Document', checked: sort === 'document', keepOpen: true, onSelect: pick(setSort, 'document') },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Annotations"
        subtitle={data ? `${plural(stats.highlights, 'highlight')} · ${plural(stats.notes, 'note')} · ${plural(stats.documents, 'document')}` : undefined}
        backTo="/"
        backLabel="Back to Home"
      />

      {error && !data ? (
        <Notice tone="error" title="Couldn’t load annotations" action={<button className="btn-primary" onClick={() => void reload()}>Try again</button>}>
          {error}
        </Notice>
      ) : loading && !data ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Notice title="No annotations yet">Select text in a document to highlight it, or add a note. Everything you add shows up here.</Notice>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <SearchField className="min-w-[200px] flex-1" value={query} onChange={(v) => { setQuery(v); reset(); }} placeholder="Search highlights and notes" />
            <label className="field min-w-0 max-w-[220px] flex-1 sm:flex-none">
              <Icon name="book" className="h-[18px] w-[18px] shrink-0 text-gray-500 dark:text-gray-400" />
              <select value={doc} onChange={(e) => { setDoc(e.target.value); reset(); }} aria-label="Filter by document">
                <option value="all">All documents</option>
                {docOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <Menu label="Filter and sort" icon="sliders" entries={viewEntries} badge={kind !== 'all' || sort !== 'newest'} buttonClassName="btn-ghost btn-sq" />
          </div>

          {filtered.length === 0 ? (
            <Notice title="No annotations match">Try a different search or filter.</Notice>
          ) : (
            groups.map((g) => (
              <section key={g.docId} aria-label={g.docName}>
                <div className="mb-3 flex items-center gap-3">
                  <span className="h-12 w-9 shrink-0 rounded-md" style={{ backgroundColor: coverColor(g.docName) }} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[17px] font-bold">{g.docName}</h2>
                    <div className="mute">{g.folder} · {plural(g.list.length, 'annotation')}</div>
                  </div>
                  <Link to={viewerPath(g.docId)} className="btn-plain focus-ring" aria-label={`Open ${g.docName}`} title="Open document"><Icon name="book" /></Link>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {g.list.map((a) => {
                    const highlight = kindOf(a) === 'highlight';
                    return (
                      <article key={a.id} className="card flex flex-col gap-2 p-[18px]">
                        <div className="flex items-center gap-2 text-[13px]">
                          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: highlight ? a.color ?? DEFAULT_COLOR : NOTE_COLOR }} />
                          <b>{highlight ? 'Highlight' : 'Note'}</b>
                          <span className="mute ml-auto">Page {a.page} · {formatDay(a.modified || a.created)}</span>
                        </div>
                        {highlight && (
                          <p className="m-0 rounded-lg px-2.5 py-2 text-[15px] leading-relaxed" style={{ backgroundColor: tint(a.color) }}>
                            {a.text.trim()}
                          </p>
                        )}
                        {a.note && <p className={`m-0 leading-normal ${highlight ? 'text-sm font-semibold' : 'text-[15px] font-semibold'}`}>{a.note}</p>}
                        <Link to={viewerPath(a.docId, a.page)} className="focus-ring mt-auto inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold underline">
                          Go to page {a.page} <Icon name="arrow" className="h-3.5 w-3.5" />
                        </Link>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}

          {filtered.length > 0 && (
            <div className="mt-2 flex flex-col items-center gap-3">
              <span className="mute">Showing {Math.min(shown, filtered.length)} of {filtered.length.toLocaleString()}</span>
              {shown < filtered.length && (
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
