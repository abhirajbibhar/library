import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Pencil, Plus, Quote as QuoteIcon, Search, Trash2, Upload } from 'lucide-react';
import { useLibraryStore } from '../store';
import { downloadText } from '../lib/export';
import { plural } from '../lib/format';
import QuoteDialog from '../components/QuoteDialog';
import type { UserQuote } from '../types';

const attribution = (q: UserQuote) =>
  [q.author, q.book && (q.year ? `${q.book}, ${q.year}` : q.book) || (q.year ? String(q.year) : ''), q.page ? `p. ${q.page}` : ''].filter(Boolean).join(' · ');

/** The quotes you picked. They live in one JSON file in your bucket (_library/quotes.json) and feed the dashboard's daily quote. */
export default function Quotes() {
  const { quotes, deleteQuote, importQuotes, showNotice, books } = useLibraryStore();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Partial<UserQuote> | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const shown = quotes.filter((x) => !q || `${x.text} ${x.author} ${x.book} ${x.note}`.toLowerCase().includes(q));

  const download = () => downloadText('quotes.json', JSON.stringify({ version: 1, quotes }, null, 2), 'application/json');

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = Array.isArray(data) ? data : data?.quotes;
      if (!Array.isArray(list)) throw new Error('No quotes found in that file');
      const added = await importQuotes(list);
      showNotice(added ? `Imported ${plural(added, 'quote')}` : 'Nothing new to import');
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Couldn’t read that file');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3"><QuoteIcon className="w-7 h-7 text-purple-400" />Quotes</h1>
          <p className="text-gray-400 mt-1 text-sm sm:text-base">Passages you chose, with their source. One of them shows on your dashboard each day.</p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <button onClick={() => setEditing({})} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"><Plus className="w-4 h-4" />Add quote</button>
          <button onClick={download} disabled={quotes.length === 0} aria-label="Download quotes.json" title="Download quotes.json" className="p-2.5 rounded-md bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 transition-colors"><Download className="w-4 h-4" /></button>
          <button onClick={() => file.current?.click()} aria-label="Import quotes from a JSON file" title="Import from JSON" className="p-2.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors"><Upload className="w-4 h-4" /></button>
          <input ref={file} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </div>

      {quotes.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search quotes, authors, books…" aria-label="Search quotes"
            className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-800 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
        </div>
      )}

      {quotes.length === 0 ? (
        <div className="bg-gray-900 rounded-md border border-gray-800 py-16 px-6 text-center">
          <QuoteIcon className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-white font-semibold">No quotes yet</p>
          <p className="text-gray-500 text-sm mt-1 max-w-md mx-auto">Open <Link to="/notes" className="text-blue-400 hover:text-blue-300">Notes &amp; Highlights</Link> and choose “Save as quote” on a highlight, or add one yourself. Until then the dashboard shows built-in quotes.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-center text-gray-500 py-12">No quotes match your search.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((x) => {
            const book = books.find((b) => b.r2Key === x.bookKey);
            return (
              <li key={x.id} className="bg-gray-900 rounded-md border border-gray-800 p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-100 leading-relaxed whitespace-pre-line">“{x.text}”</p>
                    {attribution(x) && <p className="text-sm text-purple-300 mt-2">— {attribution(x)}</p>}
                    {x.note && <p className="text-xs text-gray-500 mt-1">{x.note}</p>}
                    {book && <Link to={`/reader/${book.id}${x.page ? `?page=${x.page}` : ''}`} className="inline-block mt-2 text-xs text-blue-400 hover:text-blue-300">Open in book</Link>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setEditing(x)} aria-label="Edit quote" title="Edit" className="p-2 rounded hover:bg-gray-800 text-gray-500 hover:text-white"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => { if (window.confirm('Delete this quote?')) void deleteQuote(x.id); }} aria-label="Delete quote" title="Delete" className="p-2 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && <QuoteDialog initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
