import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDay } from '../lib/format';
import { annotationsToCsv, annotationsToMarkdown, downloadText } from '../lib/export';
import Menu from '../components/Menu';
import QuoteDialog from '../components/QuoteDialog';
import type { UserQuote } from '../types';
import { useLibraryStore } from '../store';
import Dropdown from '../components/Dropdown';
import { 
  Highlighter, StickyNote, Search, 
  Trash2, Edit3, BookOpen, Download, X, Quote as QuoteIcon
} from 'lucide-react';

type FilterType = 'all' | 'highlight' | 'note';

const filterOptions = [
  { value: 'all', label: 'All Types' },
  { value: 'highlight', label: 'Highlights' },
  { value: 'note', label: 'Notes' },
];

export default function Notes() {
  const { annotations, books, deleteAnnotation, updateAnnotation } = useLibraryStore();
  const [params, setParams] = useSearchParams();
  const bookFilter = params.get('book') ?? '';
  const [filter, setFilter] = useState<FilterType>('all');
  const [error, setError] = useState<string | null>(null);
  const [quoteDraft, setQuoteDraft] = useState<Partial<UserQuote> | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  function getBookTitle(bookId: string) {
    return books.find(b => b.id === bookId)?.title || 'Unknown Book';
  }

  const filteredAnnotations = annotations
    .filter(a => filter === 'all' || a.type === filter)
    .filter(a => !bookFilter || a.bookId === bookFilter)
    .filter(a => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return a.content.toLowerCase().includes(q) || a.comment.toLowerCase().includes(q) || getBookTitle(a.bookId).toLowerCase().includes(q);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const handleSaveEdit = async (id: string) => {
    try {
      await updateAnnotation(id, { comment: editText });
      setEditingId(null);
      setEditText('');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your change');
    }
  };

  const startQuote = (a: typeof annotations[number]) => {
    const b = books.find(x => x.id === a.bookId);
    setQuoteDraft({ text: a.content, author: b?.author ?? '', book: b?.title ?? '', year: b?.publishedYear ?? null, page: a.page || null, bookKey: a.r2Key });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this annotation? It will also disappear from the PDF.')) return;
    try {
      await deleteAnnotation(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete');
    }
  };

  // Export what is on screen (the filtered list) in the shape the export helpers expect
  const exportItems = () => filteredAnnotations.map(a => {
    const b = books.find(x => x.id === a.bookId);
    return { docId: a.r2Key, folder: b?.folder ?? '', docName: b?.title ?? '', id: a.annotationId, page: a.page, type: a.type, text: a.type === 'highlight' ? a.content : '', note: a.type === 'highlight' ? a.comment : a.content, color: a.color ?? null, created: a.createdAt, modified: a.updatedAt };
  });

  const highlightCount = annotations.filter(a => a.type === 'highlight').length;
  const noteCount = annotations.filter(a => a.type === 'note').length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Notes & Highlights</h1>
          <p className="text-gray-400 mt-1 text-sm sm:text-base">All your annotations across books</p>
        </div>
        <Menu
          label="Export"
          icon="download"
          buttonClassName="btn-ghost btn-sq"
          entries={[
            { heading: `Export ${filteredAnnotations.length} shown` },
            { label: 'Markdown (.md)', icon: 'file', onSelect: () => downloadText('annotations.md', annotationsToMarkdown(exportItems()), 'text/markdown') },
            { label: 'Spreadsheet (.csv)', icon: 'file', onSelect: () => downloadText('annotations.csv', annotationsToCsv(exportItems()), 'text/csv') },
          ]}
        />
      </div>
      {bookFilter && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Showing only</span>
          <span className="px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-300 border border-blue-500/20">{getBookTitle(bookFilter)}</span>
          <button onClick={() => setParams({}, { replace: true })} className="p-1 rounded hover:bg-gray-800 text-gray-400" aria-label="Show all books"><X className="w-4 h-4" /></button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-md p-3 sm:p-4 flex items-center justify-center gap-3" title="Highlights">
          <Highlighter className="w-5 h-5 text-yellow-400" aria-hidden="true" />
          <p className="text-xl sm:text-2xl font-bold text-white"><span className="sr-only">Highlights: </span>{highlightCount}</p>
        </div>
        <div className="bg-purple-500/5 border border-purple-500/20 rounded-md p-3 sm:p-4 flex items-center justify-center gap-3" title="Notes">
          <StickyNote className="w-5 h-5 text-purple-400" aria-hidden="true" />
          <p className="text-xl sm:text-2xl font-bold text-white"><span className="sr-only">Notes: </span>{noteCount}</p>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search annotations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-800 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <Dropdown
          options={filterOptions}
          value={filter}
          onChange={(value) => setFilter(value as FilterType)}
          className="min-w-[140px]"
        />
      </div>

      {/* Annotations List */}
      <div className="space-y-3">
        {filteredAnnotations.length === 0 ? (
          <div className="text-center py-16">
            <StickyNote className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">No annotations found</p>
            <p className="text-gray-600 text-sm mt-1">Start reading and adding notes to your books</p>
          </div>
        ) : (
          filteredAnnotations.map(annotation => (
            <div
              key={annotation.id}
              className={`rounded-md border p-4 transition-all hover:shadow-lg ${
                annotation.type === 'highlight' 
                  ? 'bg-yellow-500/5 border-yellow-500/20 hover:border-yellow-500/30' 
                  : 'bg-purple-500/5 border-purple-500/20 hover:border-purple-500/30'
              }`}
            >
              <div className="flex flex-col gap-3">
              {/* Type & Book */}
              <div className="flex items-center gap-2 flex-wrap">
                {annotation.type === 'highlight' && <Highlighter className="w-3.5 h-3.5 text-yellow-400" />}
                {annotation.type === 'note' && <StickyNote className="w-3.5 h-3.5 text-purple-400" />}
                <span className="text-xs text-gray-500 capitalize">{annotation.type}</span>
                <span className="text-xs text-gray-600">·</span>
                <Link to={`/book/${annotation.bookId}`} className="text-xs text-blue-400 hover:text-blue-300 truncate max-w-full">
                  {getBookTitle(annotation.bookId)}
                </Link>
                {annotation.page > 0 && (
                  <>
                    <span className="text-xs text-gray-600">·</span>
                    <span className="text-xs text-gray-500">Page {annotation.page}</span>
                  </>
                )}
              </div>

              {/* Content — full width of the card; actions sit on their own row at the right edge */}
              {editingId === annotation.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-sm text-white resize-none focus:outline-none focus:border-blue-500"
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleSaveEdit(annotation.id)}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-500"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className={`w-full text-sm ${annotation.type === 'highlight' ? 'text-yellow-100/80 italic' : 'text-gray-300'} whitespace-pre-line break-words`}>
                    {annotation.type === 'highlight' ? `“${annotation.content}”` : annotation.content}
                  </p>
                  {annotation.type === 'highlight' && annotation.comment && (
                    <p className="w-full text-sm text-gray-300 mt-2 whitespace-pre-line break-words">{annotation.comment}</p>
                  )}
                </>
              )}

              {/* Date & Actions share the bottom row so the text above uses the whole card width */}
              <div className="flex items-end justify-between gap-3 mt-2">
                <p className="text-xs text-gray-600 shrink-0">{formatDay(annotation.updatedAt)}</p>
                <div className="flex items-center gap-1 flex-shrink-0 -mb-1 -mr-1">
                  <Link
                    to={`/reader/${annotation.bookId}?page=${annotation.page}`}
                    className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-white transition-colors"
                    title="Open in reader"
                  >
                    <BookOpen className="w-4 h-4" />
                  </Link>
                  <button
                    onClick={() => startQuote(annotation)}
                    className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-purple-300 transition-colors"
                    title="Save as quote"
                    aria-label="Save as quote"
                  >
                    <QuoteIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { setEditingId(annotation.id); setEditText(annotation.type === 'highlight' ? annotation.comment : annotation.content); }}
                    className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-white transition-colors"
                    title="Edit"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => void handleDelete(annotation.id)}
                    className="p-1.5 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
            </div>
          ))
        )}
      </div>
      {quoteDraft && <QuoteDialog initial={quoteDraft} onClose={() => setQuoteDraft(null)} />}
    </div>
  );
}
