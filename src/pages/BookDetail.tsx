import { useState, type ReactNode } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLibraryStore, bookIdFor } from '../store';
import { useBookActions } from '../hooks/useBookActions';
import FormDialog from '../components/FormDialog';
import Menu from '../components/Menu';
import AnnotationItem from '../components/AnnotationItem';
import BookCover from '../components/BookCover';
import { formatDay, formatDuration, plural, readingStatus } from '../lib/format';
import { readPdfDetails } from '../lib/cover';
import { useOffline } from '../lib/offline';
import { ArrowDownToLine, Calendar, CalendarPlus, Clock, FileText, Folder, Globe, Hash, HardDrive, Highlighter, Pencil, Play, Star } from 'lucide-react';

export default function BookDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getBook, getAnnotationsByBook, updateBookDetails, toggleFavorite, setSearchQuery, setActiveFilter, showNotice } = useLibraryStore();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const book = getBook(id || '');
  const savedOffline = useOffline().has(book?.r2Key ?? '');
  const { menuFor, dialog } = useBookActions((c) => {
    if (c.kind === 'doc-removed') navigate('/library', { replace: true });
    else if (c.kind === 'changed' && c.newKey) navigate(`/book/${bookIdFor(c.newKey)}`, { replace: true });
  });
  const annotations = getAnnotationsByBook(id || '');

  if (!book) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400">Book not found</p>
        <Link to="/library" className="text-blue-400 mt-4 inline-block">Back to Library</Link>
      </div>
    );
  }

  const status = readingStatus(book);
  const highlights = annotations.filter((a) => a.type === 'highlight').length;
  const recent = [...annotations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  const longDescription = book.description.length > 320;
  const searchTag = (tag: string) => { setActiveFilter('all'); setSearchQuery(tag); navigate('/library'); };

  // Facts about the file, shown once, in the Details card (empty ones are skipped)
  const details: { icon: ReactNode; label: string; value: string; wide?: boolean }[] = [
    { icon: <Folder className="w-4 h-4" />, label: 'Folder', value: book.genre },
    book.publishedYear ? { icon: <Calendar className="w-4 h-4" />, label: 'Published', value: String(book.publishedYear) } : null,
    book.language ? { icon: <Globe className="w-4 h-4" />, label: 'Language', value: book.language } : null,
    book.isbn ? { icon: <Hash className="w-4 h-4" />, label: 'ISBN', value: book.isbn } : null,
    { icon: <HardDrive className="w-4 h-4" />, label: 'Size', value: book.fileSize },
    { icon: <CalendarPlus className="w-4 h-4" />, label: 'Added', value: formatDay(book.addedAt) },
    { icon: <FileText className="w-4 h-4" />, label: 'File', value: book.r2Key, wide: true },
  ].filter((d): d is NonNullable<typeof d> => !!d && !!d.value);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Hero */}
      <section className="rounded-lg border border-gray-800 bg-gray-900 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row gap-6">
          <BookCover book={book} fit="contain" alt={`Cover of ${book.title}`} letterClassName="text-8xl" className="w-40 sm:w-48 mx-auto sm:mx-0 aspect-[5/7] rounded-md shrink-0 shadow-lg shadow-black/40" />

          <div className="flex-1 min-w-0 space-y-4">
            <div className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl sm:text-3xl font-bold text-white break-words leading-tight">{book.title}</h1>
                <p className="text-base text-gray-400 mt-1">
                  {book.author ? `by ${book.author}` : <button onClick={() => setEditing(true)} className="text-gray-500 hover:text-gray-300 underline">Add author</button>}
                </p>
              </div>
              <button
                onClick={() => void toggleFavorite(book.id).catch(() => showNotice('Could not update favourites'))}
                aria-pressed={book.favorite}
                aria-label={book.favorite ? 'Remove from favourites' : 'Add to favourites'}
                title={book.favorite ? 'Remove from favourites' : 'Add to favourites'}
                className="p-2 rounded-md hover:bg-gray-800 shrink-0"
              >
                <Star className={`w-5 h-5 ${book.favorite ? 'text-amber-300 fill-amber-300' : 'text-gray-500'}`} />
              </button>
              <button onClick={() => setEditing(true)} aria-label="Edit details" title="Edit details" className="p-2 rounded-md hover:bg-gray-800 text-gray-400 shrink-0"><Pencil className="w-5 h-5" /></button>
              <div className="shrink-0"><Menu compact label="More options" icon="more" entries={menuFor(book).filter((e) => !('id' in e && (e.id === 'favorite' || e.id === 'open')))} /></div>
            </div>

            {/* Status, folder and tags in one wrap-row */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {status && <span className={`px-2 py-1 rounded-md border font-medium ${status.className}`}>{status.label}</span>}
              {savedOffline && <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-green-500/25 bg-green-500/10 text-green-300"><ArrowDownToLine className="w-3 h-3" />Offline</span>}
              <Link to={`/collections/${encodeURIComponent(book.folder)}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"><Folder className="w-3 h-3" />{book.genre}</Link>
              {book.tags.map((t) => (
                <button key={t} onClick={() => searchTag(t)} title={`Search “${t}” in the library`} className="px-2 py-1 rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700">#{t}</button>
              ))}
            </div>

            {/* Rating */}
            <div className="flex items-center gap-0.5" role="group" aria-label="Rating">
              {Array.from({ length: 5 }).map((_, i) => (
                <button key={i} aria-label={`Rate ${i + 1} out of 5`} onClick={() => void updateBookDetails(book.id, { rating: book.rating === i + 1 ? 0 : i + 1 })} className="p-0.5">
                  <Star className={`w-5 h-5 ${i < (book.rating ?? 0) ? 'text-amber-300 fill-amber-300' : 'text-gray-600'}`} />
                </button>
              ))}
              <span className="text-sm text-gray-500 ml-2">{book.rating ? `${book.rating}/5` : 'Tap to rate'}</span>
            </div>

            {/* Progress + primary action */}
            <div className="space-y-3 pt-1">
              {book.pages > 0 ? (
                <div>
                  <div className="flex items-baseline justify-between text-sm mb-1.5">
                    <span className="font-semibold text-white tabular-nums">{book.progress}%</span>
                    <span className="text-gray-400">Page {book.lastPage} of {book.pages}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden" role="progressbar" aria-valuenow={book.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Reading progress">
                    <div className={`h-full rounded-full ${book.progress >= 100 ? 'bg-green-400' : 'bg-blue-400'}`} style={{ width: `${book.progress}%` }} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Not opened yet</p>
              )}
              <Link to={`/reader/${book.id}`} className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors">
                <Play className="w-4 h-4" />
                {book.progress >= 100 ? 'Read again' : book.progress > 0 ? 'Continue reading' : 'Start reading'}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <Stat icon={<Clock className="w-4 h-4" />} label="Time read" value={formatDuration(book.readingSeconds)} />
        <Stat icon={<Calendar className="w-4 h-4" />} label="Last read" value={book.lastReadAt ? formatDay(book.lastReadAt) : '—'} />
        <Stat icon={<Highlighter className="w-4 h-4" />} label="Annotations" value={String(annotations.length)} sub={annotations.length ? `${highlights} highlights` : undefined} />
      </div>

      {/* About */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-5 sm:p-6">
        <h2 className="text-base font-semibold text-white mb-2">About this book</h2>
        {book.description ? (
          <>
            <p className={`text-gray-300 text-sm leading-relaxed whitespace-pre-line ${longDescription && !expanded ? 'line-clamp-4' : ''}`}>{book.description}</p>
            {longDescription && <button onClick={() => setExpanded((e) => !e)} className="mt-2 text-sm text-blue-400 hover:text-blue-300">{expanded ? 'Show less' : 'Show more'}</button>}
          </>
        ) : (
          <button onClick={() => setEditing(true)} className="text-sm text-gray-500 hover:text-gray-300 underline">Add a description</button>
        )}
      </section>

      {/* Highlights & notes — the three most recent, in the same item design as the Notes page */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-5 sm:p-6" aria-labelledby="book-annotations">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 id="book-annotations" className="text-base font-semibold text-white">Highlights &amp; notes</h2>
          {annotations.length > 0 && <Link to={`/notes?book=${book.id}`} className="text-sm text-blue-400 hover:text-blue-300 shrink-0">See all {plural(annotations.length, 'item')}</Link>}
        </div>
        {recent.length > 0 ? (
          <div className="space-y-4">{recent.map((a) => <AnnotationItem key={a.id} annotation={a} compact />)}</div>
        ) : (
          <p className="text-sm text-gray-500">None yet. Highlight text or add a note while reading.</p>
        )}
      </section>

      {/* Details */}
      <section className="bg-gray-900/60 rounded-lg border border-gray-800 p-5 sm:p-6">
        <h2 className="text-base font-semibold text-white mb-3">Details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          {details.map((d) => (
            <div key={d.label} className={`flex items-start gap-2.5 min-w-0 ${d.wide ? 'sm:col-span-2' : ''}`}>
              <dt className="flex items-center gap-2 w-24 shrink-0 text-gray-500"><span aria-hidden="true">{d.icon}</span>{d.label}</dt>
              <dd className={`min-w-0 text-gray-200 ${d.wide ? 'break-all' : 'truncate'}`}>{d.value}</dd>
            </div>
          ))}
        </dl>
      </section>

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

/** A small tile: icon + label above, one value (and an optional sub-line) below. */
function Stat({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-3 sm:px-4 min-w-0">
      <p className="flex items-center gap-1.5 text-xs text-gray-500"><span aria-hidden="true">{icon}</span>{label}</p>
      <p className="mt-1 text-lg font-semibold text-white truncate">{value}</p>
      {sub && <p className="text-xs text-gray-500 truncate">{sub}</p>}
    </div>
  );
}
