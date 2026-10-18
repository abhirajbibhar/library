import { useState } from 'react';
import { useLibraryStore } from '../store';
import type { UserQuote } from '../types';
import FormDialog from './FormDialog';

type Draft = Partial<Omit<UserQuote, 'id' | 'addedAt'>> & { id?: string };

/** Add or edit a quote with its attribution. Used from Notes ("Save as quote") and the Quotes page. */
export default function QuoteDialog({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const { saveQuote, quotes, books } = useLibraryStore();
  const [text, setText] = useState(initial.text ?? '');
  const [author, setAuthor] = useState(initial.author ?? '');
  const [book, setBook] = useState(initial.book ?? '');
  const [year, setYear] = useState(initial.year ? String(initial.year) : '');
  const [page, setPage] = useState(initial.page ? String(initial.page) : '');
  const [note, setNote] = useState(initial.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const yearNum = year.trim() ? Number(year) : 0;
  const pageNum = page.trim() ? Number(page) : 0;
  const yearBad = year.trim() !== '' && (!Number.isInteger(yearNum) || yearNum < 0 || yearNum > 3000);
  const pageBad = page.trim() !== '' && (!Number.isInteger(pageNum) || pageNum < 0);
  const authors = [...new Set([...quotes.map((q) => q.author), ...books.map((b) => b.author)].filter(Boolean))].slice(0, 50);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveQuote({
        id: initial.id,
        text: text.trim(),
        author: author.trim(),
        book: book.trim(),
        year: yearNum || null,
        page: pageNum || null,
        note: note.trim(),
        bookKey: initial.bookKey ?? '',
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setBusy(false);
    }
  };

  return (
    <FormDialog title={initial.id ? 'Edit quote' : 'Save as quote'} confirmLabel="Save quote" busy={busy} error={error} disabled={!text.trim() || yearBad || pageBad} onCancel={onClose} onConfirm={() => void submit()}>
      <div className="space-y-3">
        <label className="block"><span className="mute mb-1 block">Quote</span>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={3000} className="field w-full py-2 text-sm bg-transparent resize-y" />
        </label>
        <label className="block"><span className="mute mb-1 block">Author</span>
          <span className="field"><input value={author} onChange={(e) => setAuthor(e.target.value)} list="quote-authors" maxLength={120} placeholder="Who said or wrote it" /></span>
          <datalist id="quote-authors">{authors.map((a) => <option key={a} value={a} />)}</datalist>
        </label>
        <label className="block"><span className="mute mb-1 block">Book or source</span><span className="field"><input value={book} onChange={(e) => setBook(e.target.value)} maxLength={200} /></span></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mute mb-1 block">Year</span><span className="field"><input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" aria-invalid={yearBad} /></span></label>
          <label className="block"><span className="mute mb-1 block">Page</span><span className="field"><input value={page} onChange={(e) => setPage(e.target.value)} inputMode="numeric" aria-invalid={pageBad} /></span></label>
        </div>
        <label className="block"><span className="mute mb-1 block">Note (optional)</span><span className="field"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Chapter, context, why it matters" /></span></label>
      </div>
    </FormDialog>
  );
}
