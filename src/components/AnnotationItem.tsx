import { useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Check, Highlighter, Pencil, Quote as QuoteIcon, StickyNote, Trash2, X } from 'lucide-react';
import type { Annotation } from '../types';
import { formatDay } from '../lib/format';

const HIGHLIGHT_FALLBACK = '#fbbf24'; // amber
const NOTE_ACCENT = '#a78bfa'; // violet
const HEX = /^#[0-9a-f]{6}$/i;

/** A highlight keeps the colour it was made with in the PDF; notes are violet. */
export const accentFor = (a: Pick<Annotation, 'type' | 'color'>) =>
  a.type === 'note' ? NOTE_ACCENT : a.color && HEX.test(a.color) ? a.color : HIGHLIGHT_FALLBACK;

export const readerLink = (a: Pick<Annotation, 'bookId' | 'page'>) => `/reader/${a.bookId}${a.page > 0 ? `?page=${a.page}` : ''}`;

interface AnnotationItemProps {
  annotation: Annotation;
  /** Saves the edited text (the note on a highlight, or the body of a note). Omit for a read-only item. */
  onSave?: (text: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onQuote?: () => void;
  /** Hide the action row, clamp long text (used for previews on the book page). */
  compact?: boolean;
}

const iconBtn = 'rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-500';

/**
 * One highlight or note. A coloured bar on the left carries the type/colour; highlights show the quoted text
 * with the reader's own comment beneath it. Editing and delete confirmation happen inline (no browser dialogs).
 */
export default function AnnotationItem({ annotation: a, onSave, onDelete, onQuote, compact = false }: AnnotationItemProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isHighlight = a.type === 'highlight';
  const accent = accentFor(a);
  const editable = isHighlight ? a.comment : a.content;
  const canSave = !busy && (isHighlight || text.trim() !== ''); // a note can't be saved empty; a highlight's comment can be cleared
  const clamp = compact ? 'line-clamp-3' : '';

  const run = async (job: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await job();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!onSave || !canSave) return;
    if (await run(() => onSave(text), 'Could not save your change')) setEditing(false);
  };
  const remove = async () => {
    if (!onDelete) return;
    if (!(await run(onDelete, 'Could not delete'))) setConfirming(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setEditing(false);
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
  };

  return (
    <article className="border-l-[3px] py-1 pl-4" style={{ borderLeftColor: accent }}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        {isHighlight ? <Highlighter className="h-3.5 w-3.5" style={{ color: accent }} aria-hidden="true" /> : <StickyNote className="h-3.5 w-3.5" style={{ color: accent }} aria-hidden="true" />}
        <span className="font-medium text-gray-300">{isHighlight ? 'Highlight' : 'Note'}</span>
        {a.page > 0 && <><span aria-hidden="true">·</span><span>Page {a.page}</span></>}
        <span aria-hidden="true">·</span>
        <time dateTime={a.updatedAt}>{formatDay(a.updatedAt)}</time>
      </header>

      {isHighlight && (
        <blockquote className={`mt-2 whitespace-pre-line break-words rounded-md px-3 py-2 text-sm italic leading-relaxed text-gray-100 ${clamp}`} style={{ backgroundColor: `${accent}1a` }}>
          “{a.content}”
        </blockquote>
      )}

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            placeholder={isHighlight ? 'Add a note to this highlight…' : 'Write your note…'}
            aria-label={isHighlight ? 'Note on this highlight' : 'Note text'}
            className="w-full resize-y rounded-md border border-gray-700 bg-gray-800 p-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void save()} disabled={!canSave} className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"><Check className="h-3.5 w-3.5" />Save</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700">Cancel</button>
            <span className="ml-auto hidden text-[11px] text-gray-600 sm:inline">Ctrl/⌘ + Enter to save</span>
          </div>
        </div>
      ) : (
        editable && <p className={`whitespace-pre-line break-words text-sm leading-relaxed text-gray-300 ${isHighlight ? 'mt-2' : 'mt-1.5'} ${clamp}`}>{editable}</p>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}

      {!compact && !editing && (
        <div className="mt-1 flex items-center justify-end gap-0.5">
          {confirming ? (
            <>
              <span className="mr-1 text-xs text-gray-400" title="This also removes it from the PDF">Delete this {a.type}?</span>
              <button type="button" onClick={() => void remove()} disabled={busy} className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">Delete</button>
              <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-800"><X className="inline h-3.5 w-3.5" /><span className="sr-only">Keep</span></button>
            </>
          ) : (
            <>
              <Link to={readerLink(a)} className={iconBtn} title="Open in reader" aria-label="Open in reader"><BookOpen className="h-4 w-4" /></Link>
              {onQuote && <button type="button" onClick={onQuote} className={`${iconBtn} hover:text-purple-300`} title="Save as quote" aria-label="Save as quote"><QuoteIcon className="h-4 w-4" /></button>}
              {onSave && <button type="button" onClick={() => { setText(editable); setEditing(true); setError(null); }} className={iconBtn} title={isHighlight ? 'Edit note' : 'Edit'} aria-label="Edit"><Pencil className="h-4 w-4" /></button>}
              {onDelete && <button type="button" onClick={() => setConfirming(true)} className={`${iconBtn} hover:bg-red-500/10 hover:text-red-400`} title="Delete" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>}
            </>
          )}
        </div>
      )}
    </article>
  );
}
