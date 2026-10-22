import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLibraryStore, bookIdFor } from '../store';
import { useBookActions } from '../hooks/useBookActions';
import FormDialog from '../components/FormDialog';
import Menu from '../components/Menu';
import { coverColor, formatDay, formatDuration } from '../lib/format';
import { readPdfDetails } from '../lib/cover';
import { useOffline } from '../lib/offline';
import { Play, Star, Calendar, FileText, Globe, Hash, Highlighter, StickyNote, Clock, Folder, Pencil, MoreHorizontal } from 'lucide-react';

/** Reading status as plain words: Not started / Reading / Finished. */
function bookStatus(b: { progress: number; lastReadAt?: string }): string {
  if (b.progress >= 100) return 'Finished';
  if (b.progress > 0) return 'Reading';
  if (b.lastReadAt) return 'Started';
  return 'Not started';
}

export default function BookDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getBook, getAnnotationsByBook, updateBookDetails, toggleFavorite } = useLibraryStore();
  const [editing, setEditing] = useState(false);
  const savedOffline = useOffline().has(getBook(id || '')?.r2Key ?? '');
  const { menuFor, dialog } = useBookActions((c) => {
    if (c.kind === 'doc-removed') navigate('/library', { replace: true });
    else if (c.kind === 'changed' && c.newKey) navigate(`/book/${bookIdFor(c.newKey)}`, { replace: true });
  });

  const book = getBook(id || '');
  const annotations = getAnnotationsByBook(id || '');

  if (!book) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400">Book not found</p>
        <Link to="/library" className="text-blue-400 mt-4 inline-block">Back to Library</Link>
      </div>
    );
  }

  const highlights = annotations.filter(a => a.type === 'highlight');
  const notes = annotations.filter(a => a.type === 'note');

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Hero */}
      <div className="flex flex-col md:flex-row gap-8">
        <div className="w-44 sm:w-56 md:w-64 mx-auto md:mx-0 aspect-[5/7] rounded-md flex items-center justify-center flex-shrink-0 relative overflow-hidden" style={{ backgroundColor: book.cover ? '#1f2937' : coverColor(book.title) }}>
          {book.cover ? (
            <img src={book.cover} alt={`Cover of ${book.title}`} className="absolute inset-0 w-full h-full object-contain" />
          ) : (
            <div className="text-8xl font-bold text-white/25 select-none">{book.title.charAt(0)}</div>
          )}
          {/* Progress lives in the page count now, so the cover only carries the % chip */}
          {book.progress > 0 && (
            <div className="absolute bottom-4 right-4 px-3 py-1 rounded-sm bg-black/60 text-white/90 text-sm font-bold backdrop-blur-sm">{book.progress}%</div>
          )}
        </div>

        <div className="flex-1 space-y-4 min-w-0">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold text-white break-words">{book.title}</h1>
              <p className="text-base sm:text-lg text-gray-400 mt-1">{book.author ? `by ${book.author}` : <button onClick={() => setEditing(true)} className="text-gray-500 hover:text-gray-300 underline">Add author</button>}</p>
            </div>
            <button onClick={() => void toggleFavorite(book.id)} aria-pressed={book.favorite} aria-label={book.favorite ? 'Remove from favourites' : 'Add to favourites'} title="Favourite"
              className="p-2.5 rounded-md hover:bg-gray-800 shrink-0">
              <Star className={`w-5 h-5 ${book.favorite ? 'text-amber-300 fill-amber-300' : 'text-gray-500'}`} />
            </button>
            <button onClick={() => setEditing(true)} aria-label="Edit details" title="Edit details" className="p-2.5 rounded-md hover:bg-gray-800 text-gray-400 shrink-0"><Pencil className="w-5 h-5" /></button>
            <div className="shrink-0"><Menu label="More options" icon="more" entries={menuFor(book)} /></div>
          </div>

          {/* Rating */}
          <div className="flex items-center gap-1" role="group" aria-label="Rating">
            {Array.from({ length: 5 }).map((_, i) => (
              <button key={i} aria-label={`Rate ${i + 1} out of 5`} onClick={() => void updateBookDetails(book.id, { rating: book.rating === i + 1 ? 0 : i + 1 })} className="p-0.5">
                <Star className={`w-5 h-5 ${i < (book.rating ?? 0) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`} />
              </button>
            ))}
            {book.rating ? <span className="text-sm text-gray-400 ml-2">{book.rating}/5</span> : <span className="text-sm text-gray-600 ml-2">Tap to rate</span>}
          </div>

          {savedOffline && <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-sm bg-green-500/10 text-green-300 border border-green-500/20">Available offline</span>}

          {/* Tags */}
          {book.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">{book.tags.map(t => <span key={t} className="text-xs px-2 py-1 rounded-sm bg-gray-800 text-gray-300">{t}</span>)}</div>
          )}

          {/* Meta — pages read live inside the page icon; reading time and status share "Time read" */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <MetaItem
              icon={<FileText className="w-4 h-4" />}
              label="Pages"
              value={book.pages ? `${book.lastPage}/${book.pages}` : '—'}
              sub={book.pages ? `of ${book.pages} pages${book.progress > 0 ? ` · ${book.progress}%` : ''}` : 'Not opened yet'}
            />
            <MetaItem icon={<Folder className="w-4 h-4" />} label="Folder" value={book.genre} />
            {book.publishedYear ? <MetaItem icon={<Calendar className="w-4 h-4" />} label="Published" value={String(book.publishedYear)} /> : null}
            {book.language ? <MetaItem icon={<Globe className="w-4 h-4" />} label="Language" value={book.language} /> : null}
            {book.isbn ? <MetaItem icon={<Hash className="w-4 h-4" />} label="ISBN" value={book.isbn} /> : null}
            <MetaItem
              icon={<Clock className="w-4 h-4" />}
              label="Time read"
              value={formatDuration(book.readingSeconds)}
              sub={`${bookStatus(book)}${book.lastReadAt ? ` · last read ${formatDay(book.lastReadAt).toLowerCase()}` : ''}`}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <Link to={`/reader/${book.id}`} className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors">
              <Play className="w-4 h-4" />
              {book.progress > 0 ? 'Continue Reading' : 'Start Reading'}
            </Link>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="bg-gray-900 rounded-md border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-3">About this book</h2>
        {book.description ? (
          <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-line">{book.description}</p>
        ) : (
          <button onClick={() => setEditing(true)} className="text-sm text-gray-500 hover:text-gray-300 underline">Add a description</button>
        )}
      </div>

      {/* Annotations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AnnotationCard icon={<Highlighter className="w-5 h-5 text-yellow-400" />} title="Highlights" count={highlights.length} items={highlights.slice(0, 2).map(h => h.content)} color="yellow" />
        <AnnotationCard icon={<StickyNote className="w-5 h-5 text-purple-400" />} title="Notes" count={notes.length} items={notes.slice(0, 2).map(n => n.content)} color="purple" />
      </div>
      {annotations.length > 0 && <Link to={`/notes?book=${book.id}`} className="text-sm text-blue-400 hover:text-blue-300">See all {annotations.length} in Notes &amp; Highlights</Link>}

      {/* File */}
      <div className="bg-gray-900/50 rounded-xl border border-gray-800/50 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{book.r2Key}</span>
          <span>Size: {book.fileSize}</span>
          <span><MoreHorizontal className="w-3 h-3 inline" /> Added {formatDay(book.addedAt)}</span>
        </div>
      </div>

      {editing && <EditDetails book={book} pdfKey={book.r2Key} onClose={() => setEditing(false)} onSave={async (d) => { await updateBookDetails(book.id, d); setEditing(false); }} />}
      {dialog}
    </div>
  );
}

function EditDetails({ book, pdfKey, onClose, onSave }: { pdfKey: string; book: { author: string; description: string; publishedYear?: number; language?: string; isbn?: string }; onClose: () => void; onSave: (d: { author: string; description: string; publishedYear: number; language: string; isbn: string }) => Promise<void> }) {
  const [author, setAuthor] = useState(book.author);
  const [description, setDescription] = useState(book.description);
  const [year, setYear] = useState(book.publishedYear ? String(book.publishedYear) : '');
  const [language, setLanguage] = useState(book.language ?? '');
  const [isbn, setIsbn] = useState(book.isbn ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  // Fill only the empty fields from what the PDF file says about itself; never overwrite what you typed
  const fillFromPdf = async () => {
    setReading(true);
    setReadNote(null);
    try {
      const d = await readPdfDetails(pdfKey);
      let filled = 0;
      if (d.author && !author.trim()) { setAuthor(d.author); filled++; }
      if (d.description && !description.trim()) { setDescription(d.description); filled++; }
      if (d.language && !language.trim()) { setLanguage(d.language); filled++; }
      setReadNote(filled ? `Filled in ${filled} ${filled === 1 ? 'field' : 'fields'} from the PDF.` : 'The PDF doesn’t state anything new.');
    } catch {
      setReadNote('Couldn’t read the PDF. Check your connection.');
    } finally {
      setReading(false);
    }
  };
  const yearNum = year.trim() ? Number(year) : 0;
  const yearBad = year.trim() !== '' && (!Number.isInteger(yearNum) || yearNum < 0 || yearNum > 3000);

  return (
    <FormDialog title="Edit details" confirmLabel="Save" busy={busy} error={error} disabled={yearBad} onCancel={onClose}
      onConfirm={() => { setBusy(true); setError(null); onSave({ author, description, publishedYear: yearNum, language, isbn }).catch((e) => { setError(e instanceof Error ? e.message : 'Could not save'); setBusy(false); }); }}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => void fillFromPdf()} disabled={reading} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-100 rounded-md text-xs font-medium transition-colors">
            {reading ? 'Reading the PDF…' : 'Fill from PDF'}
          </button>
          {readNote ? <span role="status" className="text-xs text-gray-400">{readNote}</span> : <span className="text-xs text-gray-500">Downloads the PDF once to read it</span>}
        </div>
        <label className="block"><span className="mute mb-1 block">Author</span><span className="field"><input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={120} /></span></label>
        <label className="block"><span className="mute mb-1 block">Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={5} className="field w-full py-2 text-sm bg-transparent resize-y" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mute mb-1 block">Published (year)</span><span className="field"><input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" aria-invalid={yearBad} /></span></label>
          <label className="block"><span className="mute mb-1 block">Language</span><span className="field"><input value={language} onChange={(e) => setLanguage(e.target.value)} maxLength={40} /></span></label>
        </div>
        <label className="block"><span className="mute mb-1 block">ISBN</span><span className="field"><input value={isbn} onChange={(e) => setIsbn(e.target.value)} maxLength={30} /></span></label>
      </div>
    </FormDialog>
  );
}

/** Icon and value, with an optional sub-line. The word label only appears from the sm breakpoint up, and is a tooltip/screen-reader label before that. */
function MetaItem({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0" title={label}>
      <span className="text-gray-500 shrink-0" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 hidden sm:block">{label}</p>
        <p className="text-sm text-white font-medium truncate"><span className="sr-only sm:hidden">{label}: </span>{value}</p>
        {sub && <p className="text-xs text-gray-500 truncate">{sub}</p>}
      </div>
    </div>
  );
}

function AnnotationCard({ icon, title, count, items, color }: { icon: React.ReactNode; title: string; count: number; items: string[]; color: string }) {
  const borderColors: Record<string, string> = { yellow: 'border-yellow-500/20', purple: 'border-purple-500/20' };
  return (
    <div className={`bg-gray-900 rounded-xl border ${borderColors[color]} p-4`}>
      <div className="flex items-center justify-between mb-3" title={title}>
        <div className="flex items-center gap-2" aria-hidden="true">{icon}</div>
        <span className="text-sm font-semibold text-white"><span className="sr-only">{title}: </span>{count}</span>
      </div>
      {items.length > 0 ? (
        <div className="space-y-2">{items.map((item, i) => <p key={i} className="text-xs text-gray-400 line-clamp-2 italic">“{item}”</p>)}</div>
      ) : (
        <p className="text-xs text-gray-600">None yet</p>
      )}
    </div>
  );
}
