import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, StickyNote, X } from 'lucide-react';
import { annotationsToCsv, annotationsToMarkdown, downloadText } from '../lib/export';
import { plural } from '../lib/format';
import { useLibraryStore } from '../store';
import type { Annotation, Book, UserQuote } from '../types';
import AnnotationItem from '../components/AnnotationItem';
import BookCover from '../components/BookCover';
import Menu from '../components/Menu';
import QuoteDialog from '../components/QuoteDialog';

type FilterType = 'all' | 'highlight' | 'note';

/** Shape the export helpers expect. Notes keep their body in `note`, highlights keep the quoted text in `text`. */
const toExportItem = (a: Annotation, b: Book | undefined) => ({
  docId: a.r2Key, folder: b?.folder ?? '', docName: b?.title ?? '', id: a.annotationId, page: a.page, type: a.type,
  text: a.type === 'highlight' ? a.content : '', note: a.type === 'highlight' ? a.comment : a.content,
  color: a.color ?? null, created: a.createdAt, modified: a.updatedAt,
});

export default function Notes() {
  const { annotations, books, deleteAnnotation, updateAnnotation } = useLibraryStore();
  const [params, setParams] = useSearchParams();
  const bookFilter = params.get('book') ?? '';
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [quoteDraft, setQuoteDraft] = useState<Partial<UserQuote> | null>(null);

  const bookOf = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  // "In scope" = this book (if one is chosen) and the search. The type filter is applied after, so its counts stay honest.
  const inScope = useMemo(() => {
    const q = search.trim().toLowerCase();
    return annotations.filter((a) =>
      (!bookFilter || a.bookId === bookFilter) &&
      (!q || a.content.toLowerCase().includes(q) || a.comment.toLowerCase().includes(q) || (bookOf.get(a.bookId)?.title ?? '').toLowerCase().includes(q)),
    );
  }, [annotations, bookFilter, search, bookOf]);

  const counts = useMemo(() => {
    const highlights = inScope.filter((a) => a.type === 'highlight').length;
    return { all: inScope.length, highlight: highlights, note: inScope.length - highlights };
  }, [inScope]);

  const visible = useMemo(() => inScope.filter((a) => filter === 'all' || a.type === filter), [inScope, filter]);

  // One card per book (most recently touched first); inside, annotations follow the page order of the book.
  const groups = useMemo(() => {
    const byBook = new Map<string, Annotation[]>();
    for (const a of visible) byBook.set(a.bookId, [...(byBook.get(a.bookId) ?? []), a]);
    return [...byBook.entries()]
      .map(([bookId, items]) => ({
        bookId,
        book: bookOf.get(bookId),
        items: items.sort((x, y) => x.page - y.page || x.createdAt.localeCompare(y.createdAt)),
        latest: items.reduce((m, a) => (a.updatedAt > m ? a.updatedAt : m), ''),
      }))
      .sort((x, y) => y.latest.localeCompare(x.latest));
  }, [visible, bookOf]);

  const startQuote = (a: Annotation) => {
    const b = bookOf.get(a.bookId);
    setQuoteDraft({ text: a.content, author: b?.author ?? '', book: b?.title ?? '', year: b?.publishedYear ?? null, page: a.page || null, bookKey: a.r2Key });
  };

  const exportItems = () => visible.map((a) => toExportItem(a, bookOf.get(a.bookId)));
  const tabs: { value: FilterType; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'highlight', label: 'Highlights' },
    { value: 'note', label: 'Notes' },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Notes &amp; Highlights</h1>
          <p className="mt-1 text-sm text-gray-400 sm:text-base">All your annotations across books</p>
        </div>
        <Menu
          label="Export"
          icon="download"
          buttonClassName="btn-ghost btn-sq"
          entries={[
            { heading: `Export ${visible.length} shown` },
            { label: 'Markdown (.md)', icon: 'file', onSelect: () => downloadText('annotations.md', annotationsToMarkdown(exportItems()), 'text/markdown') },
            { label: 'Spreadsheet (.csv)', icon: 'file', onSelect: () => downloadText('annotations.csv', annotationsToCsv(exportItems()), 'text/csv') },
          ]}
        />
      </div>

      {bookFilter && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Showing only</span>
          <span className="rounded-md border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-blue-300">{bookOf.get(bookFilter)?.title ?? 'Unknown book'}</span>
          <button onClick={() => setParams({}, { replace: true })} className="rounded p-1 text-gray-400 hover:bg-gray-800" aria-label="Show all books"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Search + type tabs (the tabs double as the counters) */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search annotations…"
            aria-label="Search annotations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-gray-800 bg-gray-900 py-2.5 pl-10 pr-4 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div role="tablist" aria-label="Annotation type" className="flex shrink-0 gap-0.5 rounded-md border border-gray-800 bg-gray-900 p-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              role="tab"
              aria-selected={filter === t.value}
              onClick={() => setFilter(t.value)}
              className={`flex-1 rounded-sm px-3 py-1.5 text-sm transition-colors sm:flex-none ${filter === t.value ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              {t.label} <span className="ml-1 text-xs text-gray-500">{counts[t.value]}</span>
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="py-16 text-center">
          <StickyNote className="mx-auto mb-3 h-12 w-12 text-gray-700" aria-hidden="true" />
          <p className="text-gray-500">{annotations.length === 0 ? 'No annotations yet' : 'No annotations match'}</p>
          <p className="mt-1 text-sm text-gray-600">{annotations.length === 0 ? 'Highlight text or add a note while reading and it will show up here' : 'Try a different search or filter'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(({ bookId, book, items }) => (
            <section key={bookId} className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900" aria-label={book?.title ?? 'Unknown book'}>
              <header className="flex items-center gap-3 border-b border-gray-800 bg-gray-900/80 px-4 py-3">
                {book && <BookCover book={book} className="aspect-[5/7] w-8 shrink-0 rounded-sm" letterClassName="text-sm" />}
                <div className="min-w-0 flex-1">
                  {book ? <Link to={`/book/${bookId}`} className="block truncate text-sm font-semibold text-white hover:text-blue-300">{book.title}</Link> : <p className="text-sm font-semibold text-gray-400">Unknown book</p>}
                  <p className="text-xs text-gray-500">{plural(items.length, 'annotation')}{book?.author ? ` · ${book.author}` : ''}</p>
                </div>
              </header>
              <div className="divide-y divide-gray-800/70 px-4">
                {items.map((a) => (
                  <div key={a.id} className="py-3">
                    <AnnotationItem
                      annotation={a}
                      onSave={(text) => updateAnnotation(a.id, { comment: text })}
                      onDelete={() => deleteAnnotation(a.id)}
                      onQuote={() => startQuote(a)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {quoteDraft && <QuoteDialog initial={quoteDraft} onClose={() => setQuoteDraft(null)} />}
    </div>
  );
}
