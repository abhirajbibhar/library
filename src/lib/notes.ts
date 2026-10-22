import { API_BASE } from '../config';

/**
 * Daily notes: one Markdown file per day (`_notebook/YYYY-MM-DD.md` in your bucket), laid out like an Obsidian
 * daily note. To-dos use standard task syntax, so the files read fine in Obsidian or any Markdown app:
 *
 *   ---
 *   date: 2026-10-21
 *   ---
 *   # Wednesday, 21 October 2026
 *
 *   ## To-do
 *   - [x] Finish chapter summary
 *   - [/] Review quotes (40%)
 *     - remark: Got through half, finish tomorrow
 *
 *   ## Notes
 *   Anything you like, in Markdown.
 */
export interface Task {
  text: string;
  percent: number; // 0 = not started, 100 = done
  remark: string;
}

export interface NoteDoc {
  frontmatter: string; // kept exactly as written (so tags and other fields survive)
  tasks: Task[];
  notes: string; // everything that is not the title or the to-do list
  todoExtra: string[]; // lines inside the to-do section that are neither tasks nor remarks (kept, not lost)
}

const TODO_HEADING = /^##\s+(to-?do|tasks?|plan)\b.*$/i;
const NOTES_HEADING = /^##\s+notes\s*$/i;
const TASK_LINE = /^\s*[-*+]\s+\[([ xX/])\]\s?(.*)$/;
const REMARK_LINE = /^\s+(?:[-*+]\s+remark:|>)\s*(.*)$/i;
const PERCENT_SUFFIX = /\s*\((\d{1,3})\s*%\)\s*$/;

export const clampPercent = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function parseNote(md: string): NoteDoc {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  let frontmatter = '';
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, idx) => idx > 0 && l.trim() === '---');
    if (end > 0) {
      frontmatter = lines.slice(0, end + 1).join('\n');
      i = end + 1;
    }
  }
  while (i < lines.length && !lines[i].trim()) i++;
  if (/^#\s+/.test(lines[i] ?? '')) i++; // the title is regenerated from the date

  const rest = lines.slice(i);
  const todoAt = rest.findIndex((l) => TODO_HEADING.test(l));
  let before: string[] = rest;
  let section: string[] = [];
  let after: string[] = [];
  if (todoAt >= 0) {
    before = rest.slice(0, todoAt);
    const nextHeading = rest.findIndex((l, idx) => idx > todoAt && /^##\s+/.test(l));
    section = rest.slice(todoAt + 1, nextHeading === -1 ? rest.length : nextHeading);
    after = nextHeading === -1 ? [] : rest.slice(nextHeading);
  }
  if (after.length && NOTES_HEADING.test(after[0])) after = after.slice(1); // regenerated too

  const tasks: Task[] = [];
  const todoExtra: string[] = [];
  for (const line of section) {
    const t = TASK_LINE.exec(line);
    if (t) {
      let text = t[2].trim();
      let percent = t[1] === ' ' ? 0 : t[1] === '/' ? 50 : 100;
      const m = PERCENT_SUFFIX.exec(text);
      if (m) {
        percent = clampPercent(Number(m[1]));
        text = text.replace(PERCENT_SUFFIX, '').trim();
      }
      if (t[1].toLowerCase() === 'x') percent = 100;
      tasks.push({ text, percent, remark: '' });
      continue;
    }
    const r = REMARK_LINE.exec(line);
    if (r && tasks.length) {
      const last = tasks[tasks.length - 1];
      last.remark = last.remark ? `${last.remark} ${r[1].trim()}` : r[1].trim();
      continue;
    }
    if (line.trim()) todoExtra.push(line);
  }

  const notes = [...before, ...(before.length && after.length ? [''] : []), ...after].join('\n').trim();
  return { frontmatter, tasks, notes, todoExtra };
}

export function taskToMarkdown(t: Task): string {
  const mark = t.percent >= 100 ? 'x' : t.percent > 0 ? '/' : ' ';
  const suffix = t.percent > 0 && t.percent < 100 ? ` (${t.percent}%)` : '';
  const remark = t.remark.trim() ? `\n  - remark: ${t.remark.trim().replace(/\s*\n\s*/g, ' ')}` : '';
  return `- [${mark}] ${t.text.replace(/\s*\n\s*/g, ' ').trim()}${suffix}${remark}`;
}

export function noteTitle(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function serializeNote(date: string, doc: NoteDoc): string {
  const front = doc.frontmatter.trim() || `---\ndate: ${date}\ntags: [daily]\n---`;
  const todo = [...doc.tasks.map(taskToMarkdown), ...doc.todoExtra].join('\n');
  return `${front}\n\n# ${noteTitle(date)}\n\n## To-do\n${todo}${todo ? '\n' : ''}\n## Notes\n${doc.notes.trim()}\n`;
}

/** A day with no to-dos and no notes is not worth a file: it is deleted instead of saved. */
export const isEmptyNote = (doc: NoteDoc) => doc.tasks.length === 0 && !doc.notes.trim() && doc.todoExtra.length === 0;

export function summarize(tasks: Task[]): { total: number; done: number; percent: number } {
  const total = tasks.length;
  const done = tasks.filter((t) => t.percent >= 100).length;
  const percent = total ? Math.round(tasks.reduce((n, t) => n + t.percent, 0) / total) : 0;
  return { total, done, percent };
}

// ---------------------------------------------------------------- dates
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => dayKey(new Date());
export const isDayKey = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00`));
export function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + days));
}

// ---------------------------------------------------------------- API
export interface NoteInfo {
  date: string;
  size: number;
  modified: string;
}

const enc = encodeURIComponent;

export async function listNotes(): Promise<NoteInfo[]> {
  const res = await fetch(`${API_BASE}/notes`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load your notes (${res.status})`);
  return res.json();
}

/** `text` is '' and `etag` null when there is no note for that day yet. */
export async function loadNote(date: string): Promise<{ text: string; etag: string | null }> {
  const res = await fetch(`${API_BASE}/notes/${enc(date)}`, { cache: 'no-store' });
  if (res.status === 404) return { text: '', etag: null };
  if (!res.ok) throw new Error(`Could not load this note (${res.status})`);
  return { text: await res.text(), etag: res.headers.get('ETag') };
}

export class NoteConflictError extends Error {
  constructor() {
    super('This note was changed on another device');
  }
}

/** Saves the day's Markdown; returns the new ETag. Throws NoteConflictError if it changed elsewhere meanwhile. */
export async function saveNote(date: string, text: string, etag: string | null): Promise<string | null> {
  const res = await fetch(`${API_BASE}/notes/${enc(date)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/markdown', ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }) },
    body: text,
  });
  if (res.status === 412) throw new NoteConflictError();
  if (!res.ok) throw new Error(`Could not save (${res.status})`);
  return (await res.json()).etag ?? null;
}

export async function deleteNote(date: string): Promise<void> {
  const res = await fetch(`${API_BASE}/notes/${enc(date)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Could not delete (${res.status})`);
}
