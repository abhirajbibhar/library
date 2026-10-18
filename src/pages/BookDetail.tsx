import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLibraryStore, bookIdFor } from '../store';
import { useBookActions } from '../hooks/useBookActions';
import FormDialog from '../components/FormDialog';
import Menu from '../components/Menu';
import { coverColor, formatDay, formatDuration } from '../lib/format';
import { Play, Star, Calendar, FileText, Globe, Hash, Highlighter, StickyNote, Clock, Folder, Pencil, MoreHorizontal } from 'lucide-react';

export default function BookDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getBook, getAnnotationsByBook, updateBookDetails, toggleFavorite, collections, addBookToCollection, removeBookFromCollection } = useLibraryStore();
  const [editing, setEditing] = useState(false);
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
        <div className="w-full md:w-64 h-80 md:h-96 rounded-md flex items-center justify-center flex-shrink-0 relative overflow-hidden" style={{ backgroundColor: coverColor(book.title) }}>
          {book.cover ? (
            <img src={book.cover} alt={`Cover of ${book.title}`} className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="text-8xl font-bold text-white/25 select-none">{book.title.charAt(0)}</div>
          )}
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

          {/* Tags */}
          {book.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">{book.tags.map(t => <span key={t} className="text-xs px-2 py-1 rounded-sm bg-gray-800 text-gray-300">{t}</span>)}</div>
          )}

          {/* Meta */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <MetaItem icon={<FileText className="w-4 h-4" />} label="Pages" value={book.pages ? String(book.pages) : 'Not opened yet'} />
            <MetaItem icon={<Folder className="w-4 h-4" />} label="Folder" value={book.genre} />
            {book.publishedYear ? <MetaItem icon={<Calendar className="w-4 h-4" />} label="Published" value={String(book.publishedYear)} /> : null}
            {book.language ? <MetaItem icon={<Globe className="w-4 h-4" />} label="Language" value={book.language} /> : null}
            {book.isbn ? <MetaItem icon={<Hash className="w-4 h-4" />} label="ISBN" value={book.isbn} /> : null}
            <MetaItem icon={<Clock className="w-4 h-4" />} label="Time read" value={formatDuration(book.readingSeconds)} />
          </div>

          {/* Progress */}
          <div className="bg-gray-900 rounded-md border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-400">Reading Progress</span>
              <span className="text-2xl font-bold text-white">{book.progress}%</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${book.progress}%` }} /></div>
            <p className="text-xs text-gray-500 mt-2">
              {book.pages ? `Page ${book.lastPage} of ${book.pages}` : 'Progress is saved automatically as you read.'}
              {book.lastReadAt ? ` · last read ${formatDay(book.lastReadAt).toLowerCase()}` : ''}
            </p>
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

      {/* Collections */}
      {collections.length > 0 && (
        <div className="bg-gray-900 rounded-md border border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-3">Collections</h2>
          <div className="flex flex-wrap gap-2">
            {collections.map(c => {
              const inIt = book.collectionIds.includes(c.id);
              return (
                <button key={c.id} aria-pressed={inIt} onClick={() => void (inIt ? removeBookFromCollection(c.id, book.id) : addBookToCollection(c.id, book.id))}
                  className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${inIt ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}>
                  {c.icon} {c.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

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

      {editing && <EditDetails book={book} onClose={() => setEditing(false)} onSave={async (d) => { await updateBookDetails(book.id, d); setEditing(false); }} />}
      {dialog}
    </div>
  );
}

function EditDetails({ book, onClose, onSave }: { book: { author: string; description: string; publishedYear?: number; language?: string; isbn?: string }; onClose: () => void; onSave: (d: { author: string; description: string; publishedYear: number; language: string; isbn: string }) => Promise<void> }) {
  const [author, setAuthor] = useState(book.author);
  const [description, setDescription] = useState(book.description);
  const [year, setYear] = useState(book.publishedYear ? String(book.publishedYear) : '');
  const [language, setLanguage] = useState(book.language ?? '');
  const [isbn, setIsbn] = useState(book.isbn ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const yearNum = year.trim() ? Number(year) : 0;
  const yearBad = year.trim() !== '' && (!Number.isInteger(yearNum) || yearNum < 0 || yearNum > 3000);

  return (
    <FormDialog title="Edit details" confirmLabel="Save" busy={busy} error={error} disabled={yearBad} onCancel={onClose}
      onConfirm={() => { setBusy(true); setError(null); onSave({ author, description, publishedYear: yearNum, language, isbn }).catch((e) => { setError(e instanceof Error ? e.message : 'Could not save'); setBusy(false); }); }}>
      <div className="space-y-3">
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

function MetaItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-gray-500">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm text-white font-medium truncate">{value}</p>
      </div>
    </div>
  );
}

function AnnotationCard({ icon, title, count, items, color }: { icon: React.ReactNode; title: string; count: number; items: string[]; color: string }) {
  const borderColors: Record<string, string> = { yellow: 'border-yellow-500/20', purple: 'border-purple-500/20' };
  return (
    <div className={`bg-gray-900 rounded-xl border ${borderColors[color]} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">{icon}<span className="text-sm font-medium text-white">{title}</span></div>
        <span className="text-xs text-gray-500">{count}</span>
      </div>
      {items.length > 0 ? (
        <div className="space-y-2">{items.map((item, i) => <p key={i} className="text-xs text-gray-400 line-clamp-2 italic">“{item}”</p>)}</div>
      ) : (
        <p className="text-xs text-gray-600">No {title.toLowerCase()} yet</p>
      )}
    </div>
  );
}
