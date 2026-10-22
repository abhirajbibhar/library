import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, ListTodo, Plus, Trash2 } from 'lucide-react';
import { useFetch } from '../hooks/useFetch';
import { useLibraryStore } from '../store';
import {
  NoteConflictError, clampPercent, deleteNote, isDayKey, isEmptyNote, listNotes, loadNote, noteTitle, parseNote,
  saveNote, serializeNote, shiftDay, summarize, today, type NoteDoc, type Task,
} from '../lib/notes';
import { renderMarkdown } from '../lib/markdown';
import { buildZip } from '../lib/zip';
import { downloadText } from '../lib/export';
import { modKey } from '../lib/platform';
import { plural } from '../lib/format';
import FormDialog from '../components/FormDialog';
import Menu from '../components/Menu';

type Tab = 'plan' | 'preview' | 'source';
type Status = 'loading' | 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict';

const SAVE_DELAY_MS = 1200;
const QUICK = [25, 50, 75, 100];

/** The daily note: plan the day, tick things off or set a percentage, add remarks, write notes. Saved as Markdown. */
export default function Notebook() {
  const params = useParams();
  const navigate = useNavigate();
  const date = params.date && isDayKey(params.date) ? params.date : today();
  const isToday = date === today();
  const { showNotice } = useLibraryStore();

  const [md, setMd] = useState('');
  const [status, setStatus] = useState<Status>('loading');
  const [tab, setTab] = useState<Tab>('plan');
  const [daysOpen, setDaysOpen] = useState(false);
  const etagRef = useRef<string | null>(null);
  const dateRef = useRef(date);
  const mdRef = useRef('');
  const dirtyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savingRef = useRef(false);
  const notes = useFetch(() => listNotes());
  const reloadNotes = notes.reload;

  const doc = useMemo(() => parseNote(md), [md]);
  const { total, done, percent } = summarize(doc.tasks);

  // ------------------------------------------------------------ saving
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!dirtyRef.current || savingRef.current) return;
    const day = dateRef.current;
    const text = mdRef.current;
    const parsed = parseNote(text);
    savingRef.current = true;
    setStatus('saving');
    try {
      if (isEmptyNote(parsed)) {
        if (etagRef.current) await deleteNote(day); // an empty day leaves no file behind
        etagRef.current = null;
      } else {
        etagRef.current = await saveNote(day, text, etagRef.current);
      }
      if (mdRef.current === text) dirtyRef.current = false;
      setStatus(dirtyRef.current ? 'dirty' : 'saved');
      if (dirtyRef.current) timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS); // edited while saving
      else void reloadNotes(true);
    } catch (err) {
      if (err instanceof NoteConflictError) setStatus('conflict');
      else {
        setStatus('offline');
        timer.current = setTimeout(() => void flush(), 15_000); // try again shortly
      }
    } finally {
      savingRef.current = false;
    }
  }, [reloadNotes]);

  const change = useCallback((next: string) => {
    mdRef.current = next;
    dirtyRef.current = true;
    setMd(next);
    setStatus((s) => (s === 'conflict' ? s : 'dirty'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  const edit = (patch: Partial<NoteDoc>) => change(serializeNote(date, { ...doc, ...patch }));

  // ------------------------------------------------------------ loading a day (saving the previous one first)
  useEffect(() => {
    let live = true;
    (async () => {
      if (dateRef.current !== date) await flush();
      dateRef.current = date;
      setStatus('loading');
      try {
        const { text, etag } = await loadNote(date);
        if (!live) return;
        etagRef.current = etag;
        mdRef.current = text;
        dirtyRef.current = false;
        setMd(text);
        setStatus('saved');
      } catch {
        if (live) setStatus('offline');
      }
    })();
    return () => { live = false; };
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  // save when leaving, when the tab is hidden, when the connection returns, and with Ctrl/⌘+S
  useEffect(() => {
    const save = () => void flush();
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    };
    const onHide = () => document.visibilityState === 'hidden' && save();
    window.addEventListener('online', save);
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('online', save);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
      save();
    };
  }, [flush]);

  // ------------------------------------------------------------ carry over from the last day that has unfinished tasks
  const previous = useMemo(() => (notes.data ?? []).find((n) => n.date < date)?.date ?? null, [notes.data, date]);
  const [carry, setCarry] = useState<{ from: string; tasks: Task[] } | null>(null);
  useEffect(() => {
    setCarry(null);
    if (status === 'loading' || doc.tasks.length > 0 || !previous) return;
    let live = true;
    loadNote(previous).then(({ text }) => {
      const open = parseNote(text).tasks.filter((t) => t.percent < 100);
      if (live && open.length) setCarry({ from: previous, tasks: open });
    }).catch(() => {});
    return () => { live = false; };
  }, [date, previous, status === 'loading', doc.tasks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ task actions
  const setTask = (i: number, patch: Partial<Task>) => edit({ tasks: doc.tasks.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });
  const addTasks = (texts: string[]) => {
    const fresh = texts.map((t) => t.replace(/^\s*[-*+]\s+(\[[ xX/]\]\s*)?/, '').trim()).filter(Boolean).map((text): Task => ({ text, percent: 0, remark: '' }));
    if (fresh.length) edit({ tasks: [...doc.tasks, ...fresh] });
  };
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= doc.tasks.length) return;
    const next = [...doc.tasks];
    [next[i], next[j]] = [next[j], next[i]];
    edit({ tasks: next });
  };

  // ------------------------------------------------------------ downloads
  const downloadAll = async () => {
    try {
      const list = await listNotes();
      const files: { name: string; data: Uint8Array; modified: Date }[] = [];
      const enc = new TextEncoder();
      for (const n of list) {
        const { text } = await loadNote(n.date);
        if (text) files.push({ name: `${n.date}.md`, data: enc.encode(text), modified: new Date(n.modified) });
      }
      if (!files.length) return showNotice('No notes to download yet');
      const url = URL.createObjectURL(buildZip(files));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'daily-notes.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      showNotice('Couldn’t download your notes. Check your connection.');
    }
  };

  const statusLabel: Record<Status, string> = {
    loading: 'Loading…', saved: 'Saved', dirty: 'Unsaved changes', saving: 'Saving…', offline: 'Not saved yet. Will retry.', conflict: 'Changed on another device',
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Day header */}
      <div className="flex items-center gap-2">
        <button onClick={() => navigate(`/notebook/${shiftDay(date, -1)}`)} aria-label="Previous day" title="Previous day" className="p-2 rounded-md hover:bg-gray-800 text-gray-400"><ChevronLeft className="w-5 h-5" /></button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="text-lg sm:text-2xl font-bold text-white truncate">{isToday ? 'Today' : noteTitle(date).split(',')[0]}</h1>
          <p className="text-xs sm:text-sm text-gray-400">{noteTitle(date)}</p>
        </div>
        <button onClick={() => navigate(`/notebook/${shiftDay(date, 1)}`)} aria-label="Next day" title="Next day" className="p-2 rounded-md hover:bg-gray-800 text-gray-400"><ChevronRight className="w-5 h-5" /></button>
        <label className="relative p-2 rounded-md hover:bg-gray-800 text-gray-400 cursor-pointer" title="Pick a date">
          <CalendarDays className="w-5 h-5" />
          <span className="sr-only">Pick a date</span>
          <input type="date" value={date} onChange={(e) => e.target.value && navigate(`/notebook/${e.target.value}`)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Pick a date" />
        </label>
        <Menu
          label="Notebook options"
          entries={[
            { label: 'All days', icon: 'list', onSelect: () => setDaysOpen(true) },
            { label: 'Download this day (.md)', icon: 'download', onSelect: () => downloadText(`${date}.md`, mdRef.current || serializeNote(date, doc), 'text/markdown') },
            { label: 'Download all notes (.zip)', icon: 'download', onSelect: () => void downloadAll() },
            ...(!isToday ? [{ label: 'Go to today', icon: 'clock' as const, to: '/notebook' }] : []),
          ]}
        />
      </div>

      {/* Tabs and save status */}
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-md bg-gray-900 border border-gray-800 p-0.5" role="tablist">
          {(['plan', 'preview', 'source'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${tab === t ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'}`}>
              {t === 'plan' ? 'Plan' : t === 'preview' ? 'Preview' : 'Markdown'}
            </button>
          ))}
        </div>
        <span role="status" className={`text-xs ${status === 'offline' || status === 'conflict' ? 'text-amber-300' : status === 'saved' ? 'text-green-400' : 'text-gray-500'}`}>
          {status === 'saved' && <Check className="w-3 h-3 inline mr-1" />}{statusLabel[status]}
        </span>
      </div>

      {status === 'conflict' && (
        <div role="alert" className="bg-amber-500/10 border border-amber-500/20 rounded-md px-4 py-3 text-sm text-amber-200 flex flex-wrap items-center gap-3">
          <span>This note was changed on another device.</span>
          <button className="font-medium underline" onClick={async () => { const r = await loadNote(date); etagRef.current = r.etag; mdRef.current = r.text; dirtyRef.current = false; setMd(r.text); setStatus('saved'); }}>Load the latest</button>
          <button className="font-medium underline" onClick={async () => { const r = await loadNote(date); etagRef.current = r.etag; dirtyRef.current = true; setStatus('dirty'); void flush(); }}>Keep mine</button>
        </div>
      )}

      {tab === 'source' && (
        <textarea value={md || serializeNote(date, doc)} onChange={(e) => change(e.target.value)} spellCheck={false} aria-label="Markdown source"
          className="w-full min-h-[60vh] bg-gray-900 border border-gray-800 rounded-md p-4 text-sm text-gray-100 font-mono leading-relaxed focus:outline-none focus:border-blue-500" />
      )}

      {tab === 'preview' && (
        <div className="bg-gray-900 border border-gray-800 rounded-md p-5 min-h-[40vh]">
          {md.trim() ? renderMarkdown(md) : <p className="text-gray-500 text-sm">Nothing written for this day.</p>}
        </div>
      )}

      {tab === 'plan' && (
        <>
          {/* Carry over */}
          {carry && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-md px-4 py-3 text-sm text-blue-100 flex flex-wrap items-center gap-3">
              <span>{plural(carry.tasks.length, 'unfinished task')} from {noteTitle(carry.from).split(',')[0]}, {carry.from.slice(5)}.</span>
              <button onClick={() => { edit({ tasks: carry.tasks.map((t) => ({ ...t })) }); setCarry(null); }} className="font-medium underline">Carry them over</button>
            </div>
          )}

          {/* To-dos */}
          <section className="bg-gray-900 rounded-md border border-gray-800">
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-gray-800">
              <h2 className="flex items-center gap-2 text-base font-semibold text-white"><ListTodo className="w-5 h-5 text-blue-400" />To-do</h2>
              {total > 0 && <span className="text-sm text-gray-400">{done} of {total} done · {percent}%</span>}
            </div>
            {total > 0 && <div className="h-1 bg-gray-800"><div className="h-full bg-blue-500 transition-all" style={{ width: `${percent}%` }} /></div>}

            <ul>
              {doc.tasks.map((t, i) => (
                <TaskRow key={i} task={t} first={i === 0} last={i === doc.tasks.length - 1}
                  onChange={(patch) => setTask(i, patch)} onDelete={() => edit({ tasks: doc.tasks.filter((_, idx) => idx !== i) })} onMove={(by) => move(i, by)} />
              ))}
            </ul>

            <form className="flex items-center gap-2 px-4 sm:px-5 py-3 border-t border-gray-800" onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem('task') as HTMLInputElement;
              addTasks(input.value.split('\n'));
              input.value = '';
            }}>
              <Plus className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" />
              <input name="task" autoComplete="off" placeholder={total ? 'Add a to-do and press Enter' : 'What will you do today? Press Enter after each to-do'} aria-label="Add a to-do"
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text');
                  if (text.includes('\n')) { e.preventDefault(); addTasks(text.split('\n')); }
                }}
                className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none" />
            </form>
          </section>

          {/* Notes */}
          <section className="bg-gray-900 rounded-md border border-gray-800">
            <div className="flex items-center gap-2 px-4 sm:px-5 py-4 border-b border-gray-800">
              <FileText className="w-5 h-5 text-purple-400" />
              <h2 className="text-base font-semibold text-white">Notes</h2>
              <span className="text-xs text-gray-500 ml-auto hidden sm:inline">Markdown · {modKey}+S saves now</span>
            </div>
            <textarea value={doc.notes} onChange={(e) => edit({ notes: e.target.value })} rows={10} aria-label="Notes for the day"
              placeholder="Write your notes for the day, in Markdown. How did it go? What did you learn?"
              className="w-full bg-transparent px-4 sm:px-5 py-4 text-sm text-gray-100 leading-relaxed resize-y focus:outline-none min-h-[200px]" />
          </section>

          <p className="text-xs text-gray-500 text-center">Saved as <code className="text-gray-400">_notebook/{date}.md</code> in your bucket, in plain Markdown.</p>
        </>
      )}

      {daysOpen && <DaysDialog notes={notes.data ?? []} current={date} onClose={() => setDaysOpen(false)} />}
    </div>
  );
}

function TaskRow({ task, first, last, onChange, onDelete, onMove }: { task: Task; first: boolean; last: boolean; onChange: (p: Partial<Task>) => void; onDelete: () => void; onMove: (by: number) => void }) {
  const [open, setOpen] = useState(false);
  const done = task.percent >= 100;
  return (
    <li className="border-b border-gray-800/70 last:border-b-0">
      <div className="flex items-start gap-3 px-4 sm:px-5 py-3">
        <button onClick={() => onChange({ percent: done ? 0 : 100 })} role="checkbox" aria-checked={done} aria-label={done ? 'Mark as not done' : 'Mark as done'}
          className={`mt-0.5 w-5 h-5 shrink-0 rounded border flex items-center justify-center transition-colors ${done ? 'bg-green-600 border-green-600' : task.percent > 0 ? 'border-amber-500' : 'border-gray-600 hover:border-gray-400'}`}>
          {done ? <Check className="w-3.5 h-3.5 text-white" /> : task.percent > 0 ? <span className="w-2 h-0.5 bg-amber-400 rounded" /> : null}
        </button>
        <div className="min-w-0 flex-1">
          <input value={task.text} onChange={(e) => onChange({ text: e.target.value })} aria-label="To-do"
            className={`w-full bg-transparent text-sm focus:outline-none ${done ? 'text-gray-500 line-through' : 'text-white'}`} />
          {task.remark && !open && <p className="text-xs text-gray-500 mt-1">{task.remark}</p>}
        </div>
        {task.percent > 0 && task.percent < 100 && <span className="text-xs font-medium text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded shrink-0">{task.percent}%</span>}
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Progress and remark" title="Progress and remark" className="p-1 rounded hover:bg-gray-800 text-gray-500 shrink-0">
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="px-4 sm:px-5 pb-4 pl-12 sm:pl-13 space-y-3">
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={100} step={5} value={task.percent} onChange={(e) => onChange({ percent: clampPercent(Number(e.target.value)) })} aria-label="Percent done" className="flex-1 accent-blue-500" />
            <span className="w-10 text-right text-sm text-gray-300 tabular-nums">{task.percent}%</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK.map((p) => (
              <button key={p} onClick={() => onChange({ percent: p })} className={`px-2.5 py-1 rounded text-xs font-medium ${task.percent === p ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>{p}%</button>
            ))}
            <button onClick={() => onChange({ percent: 0 })} className="px-2.5 py-1 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700">Reset</button>
          </div>
          <input value={task.remark} onChange={(e) => onChange({ remark: e.target.value })} placeholder="Remark (how did it go?)" aria-label="Remark"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
          <div className="flex items-center gap-1">
            <button onClick={() => onMove(-1)} disabled={first} className="px-2.5 py-1 rounded text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40">Move up</button>
            <button onClick={() => onMove(1)} disabled={last} className="px-2.5 py-1 rounded text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40">Move down</button>
            <button onClick={onDelete} aria-label="Delete to-do" title="Delete to-do" className="ml-auto p-2 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
          </div>
        </div>
      )}
    </li>
  );
}

function DaysDialog({ notes, current, onClose }: { notes: { date: string; size: number }[]; current: string; onClose: () => void }) {
  return (
    <FormDialog title="All days" onCancel={onClose}>
      {notes.length === 0 ? (
        <p className="mute">No notes yet.</p>
      ) : (
        <ul className="max-h-[50vh] overflow-y-auto -mx-2">
          {notes.map((n) => (
            <li key={n.date}>
              <Link to={`/notebook/${n.date}`} onClick={onClose} className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-md hover:bg-gray-800 ${n.date === current ? 'bg-gray-800' : ''}`}>
                <span className="text-sm text-white">{noteTitle(n.date)}</span>
                <span className="text-xs text-gray-500 shrink-0">{n.date}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </FormDialog>
  );
}
