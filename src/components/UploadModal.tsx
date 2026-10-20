import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { takePendingFiles } from '../lib/launchFiles';
import { AlertCircle, Check, Clock, FileText, Upload, X } from 'lucide-react';
import { putCover, setDocState, uploadDocument } from '../lib/db';
import { inspectPdf } from '../lib/cover';
import { formatSize, plural } from '../lib/format';
import { folderNameError } from '../lib/names';
import { useLibraryStore } from '../store';
import Dropdown from './Dropdown';

const MAX_BYTES = 95 * 1024 * 1024; // keep in sync with MAX_PDF_BYTES in workers/worker.ts
const NEW_FOLDER = '__new__';

type Status = 'ready' | 'exists' | 'uploading' | 'done' | 'error' | 'invalid';
interface Item {
  uid: number;
  file: File;
  status: Status;
  progress: number;
  message?: string;
  replace?: boolean;
}
let nextUid = 1;

const keyName = (f: File) => (/\.pdf$/i.test(f.name) ? f.name : `${f.name}.pdf`);
function fileProblem(f: File): string | null {
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return 'Only PDF files can be added';
  if (f.size === 0) return 'This file is empty';
  if (f.size > MAX_BYTES) return `Too large, the limit is ${formatSize(MAX_BYTES)}`;
  return null;
}

/** Adds PDFs to a folder (existing or new): progress, duplicate check, and a cover drawn from page 1. */
export default function UploadModal({ onClose, defaultFolder }: { onClose: () => void; defaultFolder?: string }) {
  const { docs, refresh } = useLibraryStore();
  const folders = useMemo(() => [...new Set(docs.map((d) => d.folder))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [docs]);
  const existing = useMemo(() => new Set(docs.map((d) => d.id)), [docs]);

  const [choice, setChoice] = useState(defaultFolder && folders.includes(defaultFolder) ? defaultFolder : NEW_FOLDER);
  const [newName, setNewName] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const aborts = useRef(new Map<number, AbortController>());

  const isNew = choice === NEW_FOLDER;
  const folder = isNew ? newName.trim() : choice;
  const nameError = isNew && newName ? folderNameError(folder) : null;
  const folderOk = isNew ? !!folder && !folderNameError(folder) : !!folder;

  // PDFs sent here with "Open with My Library" (Windows / macOS desktop app)
  useEffect(() => {
    const opened = takePendingFiles();
    if (opened.length) add(opened);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = useCallback((uid: number, change: Partial<Item>) => setItems((l) => l.map((i) => (i.uid === uid ? { ...i, ...change } : i))), []);

  const add = (files: FileList | File[]) =>
    setItems((l) => [
      ...l,
      ...[...files].map((file): Item => {
        const problem = fileProblem(file);
        return { uid: nextUid++, file, status: problem ? 'invalid' : 'ready', progress: 0, message: problem ?? undefined };
      }),
    ]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) add(e.dataTransfer.files);
  };

  const rows = items.map((it) =>
    it.status === 'ready' && !it.replace && folderOk && existing.has(`${folder}/${keyName(it.file)}`) ? { ...it, status: 'exists' as Status, message: `Already in ${folder}` } : it,
  );
  const ready = rows.filter((r) => r.status === 'ready');
  const doneCount = rows.filter((r) => r.status === 'done').length;

  const start = async () => {
    if (!folderOk || busy) return;
    setBusy(true);
    for (const r of ready) {
      const ctrl = new AbortController();
      aborts.current.set(r.uid, ctrl);
      patch(r.uid, { status: 'uploading', progress: 0, message: undefined });
      const key = `${folder}/${keyName(r.file)}`;
      const isNewBook = !existing.has(key); // a replaced file keeps the details you already entered
      try {
        await uploadDocument(key, r.file, { signal: ctrl.signal, onProgress: (p) => patch(r.uid, { progress: p }) });
        patch(r.uid, { status: 'done', progress: 1 });
        // One read of the PDF gives the cover (page 1) and whatever author, subject and language the file declares.
        void inspectPdf(r.file)
          .then(async ({ cover, details }) => {
            if (cover) await putCover(key, cover);
            if (isNewBook && Object.keys(details).length > 0) await setDocState(key, { meta: details });
            await refresh(true);
          })
          .catch((e) => console.warn('Cover and details not created:', e));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') patch(r.uid, { status: 'ready', progress: 0 });
        else patch(r.uid, { status: 'error', message: err instanceof Error ? err.message : 'Upload failed' });
      } finally {
        aborts.current.delete(r.uid);
      }
    }
    setBusy(false);
    void refresh(true);
  };

  const remove = (uid: number) => {
    aborts.current.get(uid)?.abort();
    setItems((l) => l.filter((i) => i.uid !== uid));
  };

  const folderOptions = [{ value: NEW_FOLDER, label: '+ Create new folder' }, ...folders.map((f) => ({ value: f, label: f }))];

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Add books" className="bg-gray-900 rounded-md border border-gray-800 p-5 sm:p-6 max-w-lg w-full max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">Add books</h2>
          <button onClick={onClose} disabled={busy} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-800 disabled:opacity-40" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <label className="text-xs text-gray-400 block mb-1.5">Folder</label>
        <Dropdown options={folderOptions} value={choice} onChange={setChoice} />
        {isNew && (
          <div className="mt-3">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New folder name" aria-label="New folder name" maxLength={100}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
            <p className={`text-xs mt-1.5 ${nameError ? 'text-red-400' : 'text-gray-500'}`} role={nameError ? 'alert' : undefined}>
              {nameError ?? (folder ? `Creates the folder ${folder} with the first file.` : 'Each folder becomes a group in your library.')}
            </p>
          </div>
        )}

        <div
          className={`mt-4 border-2 border-dashed rounded-md p-6 text-center transition-colors ${dragging ? 'border-blue-500 bg-blue-500/5' : 'border-gray-700'}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        >
          <Upload className="w-9 h-9 text-gray-500 mx-auto mb-2" />
          <p className="text-sm text-gray-400 hidden sm:block">Drag PDF files here, or</p>
          <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="sr-only" tabIndex={-1} onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
          <button type="button" onClick={() => input.current?.click()} className="mt-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-md text-sm font-medium transition-colors">Choose PDF files</button>
          <p className="text-xs text-gray-500 mt-2">PDF only, up to {formatSize(MAX_BYTES)} each. A cover is drawn from page 1, and the author is filled in if the PDF states it.</p>
        </div>

        {rows.length > 0 && (
          <ul className="mt-4 divide-y divide-gray-800">
            {rows.map((r) => (
              <li key={r.uid} className="py-3 flex items-center gap-3">
                <FileText className="w-5 h-5 text-gray-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{r.file.name}</p>
                  <p className="text-xs text-gray-500 flex items-center gap-1.5">
                    {formatSize(r.file.size)} ·{' '}
                    {r.status === 'done' ? <><Check className="w-3 h-3 text-green-400" />Uploaded</> :
                     r.status === 'uploading' ? <>Uploading {Math.round(r.progress * 100)}%</> :
                     r.status === 'ready' ? <><Clock className="w-3 h-3" />{busy ? 'Waiting' : 'Ready'}</> :
                     <span className="text-amber-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{r.message}</span>}
                  </p>
                  {r.status === 'uploading' && <div className="h-1 mt-1.5 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${Math.round(r.progress * 100)}%` }} /></div>}
                </div>
                {r.status === 'exists' && <button onClick={() => patch(r.uid, { replace: true })} className="px-3 py-1.5 bg-gray-800 text-gray-200 rounded-md text-xs hover:bg-gray-700">Replace</button>}
                {r.status !== 'done' && <button onClick={() => remove(r.uid)} className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded-md text-xs hover:bg-gray-700">{r.status === 'uploading' ? 'Cancel' : 'Remove'}</button>}
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} disabled={busy} className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 rounded-md text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50">{doneCount > 0 && !busy ? 'Done' : 'Cancel'}</button>
          <button onClick={() => void start()} disabled={!folderOk || busy || ready.length === 0} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? 'Uploading…' : ready.length ? `Upload ${plural(ready.length, 'file')}` : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
