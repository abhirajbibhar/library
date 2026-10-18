import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { putCover, uploadDocument } from '../lib/db';
import { renderCover } from '../lib/cover';
import { folderNameError } from '../lib/names';
import { useLibrary } from '../hooks/useLibrary';
import { folderPath, formatSize, plural } from '../lib/format';
import { Icon } from '../components/Icon';
import { PageHeader, PageShell } from '../components/PageShell';

const MAX_BYTES = 95 * 1024 * 1024; // keep in sync with MAX_PDF_BYTES in workers/worker.ts
const NEW_FOLDER = '__new__';

type Status = 'ready' | 'exists' | 'uploading' | 'done' | 'error' | 'invalid';

interface Item {
  uid: number;
  file: File;
  status: Status;
  progress: number; // 0..1
  message?: string;
  replace?: boolean; // the person confirmed replacing an existing file
}

let nextUid = 1;

function fileProblem(file: File): string | null {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return 'Only PDF files can be added';
  if (file.size === 0) return 'This file is empty';
  if (file.size > MAX_BYTES) return `Too large, limit is ${formatSize(MAX_BYTES)}`;
  return null;
}

/** The key must end in ".pdf" even if the browser only knew the MIME type. */
const keyName = (file: File) => (/\.pdf$/i.test(file.name) ? file.name : `${file.name}.pdf`);

export default function UploadPage() {
  const [params] = useSearchParams();
  const { documents, reload } = useLibrary();
  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of documents) counts.set(d.folder, (counts.get(d.folder) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [documents]);
  const existingIds = useMemo(() => new Set(documents.map((d) => d.id)), [documents]);

  const [choice, setChoice] = useState<string>(params.get('folder') || NEW_FOLDER);
  const [newName, setNewName] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const aborts = useRef(new Map<number, AbortController>());

  const isNew = choice === NEW_FOLDER;
  const folder = isNew ? newName.trim() : choice;
  const nameError = isNew && newName ? folderNameError(folder) : null;
  const folderOk = isNew ? !!folder && !folderNameError(folder) : !!folder;
  // A name typed for a "new" folder may already exist: treat it as that folder.
  const knownFolder = folders.some(([f]) => f === folder);

  const patch = useCallback((uid: number, change: Partial<Item>) => {
    setItems((list) => list.map((it) => (it.uid === uid ? { ...it, ...change } : it)));
  }, []);

  const addFiles = (files: FileList | File[]) => {
    const added: Item[] = [...files].map((file) => {
      const problem = fileProblem(file);
      return { uid: nextUid++, file, status: problem ? 'invalid' : 'ready', progress: 0, message: problem ?? undefined };
    });
    setItems((list) => [...list, ...added]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  /** What each row should show, given the chosen folder (so changing folder re-checks duplicates). */
  const rows = items.map((it) => {
    if (it.status === 'ready' && !it.replace && folderOk && existingIds.has(`${folder}/${keyName(it.file)}`)) {
      return { ...it, status: 'exists' as Status, message: `Already in ${folder}` };
    }
    return it;
  });

  const ready = rows.filter((r) => r.status === 'ready');
  const attention = rows.filter((r) => r.status === 'invalid' || r.status === 'error' || r.status === 'exists');
  const totalBytes = ready.reduce((n, r) => n + r.file.size, 0);
  const doneCount = rows.filter((r) => r.status === 'done').length;

  const startUpload = async () => {
    if (!folderOk || busy) return;
    setBusy(true);
    for (const r of ready) {
      const ctrl = new AbortController();
      aborts.current.set(r.uid, ctrl);
      patch(r.uid, { status: 'uploading', progress: 0, message: undefined });
      try {
        await uploadDocument(`${folder}/${keyName(r.file)}`, r.file, {
          signal: ctrl.signal,
          onProgress: (p) => patch(r.uid, { progress: p }),
        });
        patch(r.uid, { status: 'done', progress: 1 });
        // Draw page 1 as the cover. Best effort: a missing cover just falls back to the coloured card.
        void renderCover(r.file)
          .then((blob) => putCover(`${folder}/${keyName(r.file)}`, blob))
          .catch((err) => console.warn('Cover not created:', err));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') patch(r.uid, { status: 'ready', progress: 0 });
        else patch(r.uid, { status: 'error', message: err instanceof Error ? err.message : 'Upload failed' });
      } finally {
        aborts.current.delete(r.uid);
      }
    }
    setBusy(false);
    void reload(true);
  };

  const remove = (uid: number) => {
    aborts.current.get(uid)?.abort();
    setItems((list) => list.filter((it) => it.uid !== uid));
  };

  return (
    <PageShell>
      <PageHeader title="Add to Library" subtitle="Upload PDFs straight into a folder" backTo="/" backLabel="Back to Home" />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="card">
            <h2 className="text-base font-bold">1. Choose a folder</h2>
            <p className="mute mb-3.5">Pick an existing folder or create a new one. Each folder is a shelf in your Library.</p>
            <label className="field">
              <span className="mute shrink-0">Folder</span>
              <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Folder">
                <option value={NEW_FOLDER}>+ Create new folder</option>
                {folders.map(([f, n]) => (
                  <option key={f} value={f}>{f} ({n})</option>
                ))}
              </select>
            </label>
            {isNew && (
              <div className="mt-4">
                <label className="block">
                  <span className="mute mb-1.5 block">New folder name</span>
                  <span className="field">
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="For example: Interviews" aria-label="New folder name" aria-invalid={!!nameError} maxLength={100} />
                  </span>
                </label>
                <p className={`mt-2 text-[13px] ${nameError ? 'text-red-600 dark:text-red-400' : 'mute'}`} role={nameError ? 'alert' : undefined}>
                  {nameError ?? (folder && !knownFolder ? `Creates a new shelf called ${folder} when the first file is added.` : folder && knownFolder ? `${folder} already exists, files will be added to it.` : '')}
                </p>
              </div>
            )}
          </section>

          <section
            className={`flex flex-col items-center gap-2.5 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${dragging ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <Icon name="upload" className="h-[26px] w-[26px]" />
            </span>
            <div className="text-[17px] font-bold">Add your PDFs</div>
            <div className="mute hidden sm:block">Drag files here, or choose them from your device</div>
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="sr-only" tabIndex={-1} onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            <button type="button" className="btn-primary mt-1 focus-ring" onClick={() => inputRef.current?.click()}>Choose PDF files</button>
            <div className="mute">PDF only, up to {formatSize(MAX_BYTES)} each</div>
          </section>

          {rows.length > 0 && (
            <section className="card">
              <h2 className="mb-2 text-base font-bold">2. Files</h2>
              <ul>
                {rows.map((r) => (
                  <li key={r.uid} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-gray-200 py-3.5 dark:border-gray-700">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400"><Icon name="file" className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1 basis-40">
                      <div className="break-words font-semibold">{r.file.name}</div>
                      <div className="mute">{formatSize(r.file.size)}</div>
                      {r.status === 'uploading' && <div className="track mt-2"><span style={{ width: `${Math.round(r.progress * 100)}%` }} /></div>}
                    </div>
                    <div className="flex w-full items-center justify-between gap-2.5 pl-[54px] sm:w-auto sm:pl-0">
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" role={r.status === 'error' ? 'alert' : undefined}>
                        <Icon name={r.status === 'done' ? 'check' : r.status === 'uploading' ? 'upload' : r.status === 'ready' ? 'clock' : 'alert'} className="h-4 w-4" />
                        {r.status === 'done' && 'Uploaded'}
                        {r.status === 'uploading' && `Uploading ${Math.round(r.progress * 100)}%`}
                        {r.status === 'ready' && (busy ? 'Waiting' : 'Ready')}
                        {(r.status === 'invalid' || r.status === 'error' || r.status === 'exists') && r.message}
                      </span>
                      {r.status === 'exists' && (
                        <button type="button" className="btn-ghost focus-ring px-3.5! text-[13px]" onClick={() => patch(r.uid, { replace: true })}>Replace</button>
                      )}
                      {r.status !== 'done' && (
                        <button type="button" className="btn-ghost focus-ring px-3.5! text-[13px]" onClick={() => remove(r.uid)}>
                          {r.status === 'uploading' ? 'Cancel' : 'Remove'}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="card flex flex-col gap-1 lg:sticky lg:top-6">
          <h2 className="text-base font-bold">Summary</h2>
          {[
            ['Destination', folderOk ? (isNew && !knownFolder ? `${folder} (new)` : folder) : 'Not chosen'],
            ['Ready to upload', plural(ready.length, 'file')],
            ['Total size', formatSize(totalBytes)],
            ['Need attention', plural(attention.length, 'file')],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-t border-gray-200 py-2.5 text-sm dark:border-gray-700">
              <span className="mute">{label}</span>
              <b className="min-w-0 truncate">{value}</b>
            </div>
          ))}
          <button type="button" className="btn-primary focus-ring mt-3.5 w-full" disabled={!folderOk || busy || ready.length === 0} onClick={() => void startUpload()}>
            {busy ? 'Uploading…' : ready.length ? `Upload ${plural(ready.length, 'file')}` : 'Upload'}
          </button>
          <button type="button" className="btn-ghost focus-ring mt-2.5 w-full" disabled={busy || rows.length === 0} onClick={() => setItems([])}>Clear list</button>
          {doneCount > 0 && !busy && folderOk && (
            <Link to={folderPath(folder)} className="btn-ghost focus-ring mt-2.5 w-full">Open {folder}</Link>
          )}
          <p className="mute mt-3">Replacing a file that already exists keeps your last three versions.</p>
        </aside>
      </div>
    </PageShell>
  );
}
