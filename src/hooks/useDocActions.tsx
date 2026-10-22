import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { listVersions, moveDocument, restoreVersion, setDocState, trashDocument } from '../lib/db';
import { generateCoverFor } from '../lib/cover';
import { fileNameError, folderNameError, keyOf } from '../lib/names';
import { allTags } from '../lib/docs';
import { formatDay, formatSize, plural, viewerPath } from '../lib/format';
import { removeOffline, saveForOffline, useOffline } from '../lib/offline';
import { useLibraryStore } from '../store';
import type { PdfDocument, VersionInfo } from '../types';
import ConfirmDialog from '../components/ConfirmDialog';
import FormDialog from '../components/FormDialog';
import type { MenuEntry } from '../components/Menu';

export type DocChange =
  | { kind: 'changed'; newKey?: string } // favourite, tags, cover, version, rename, move (newKey = the document's key afterwards)
  | { kind: 'doc-removed'; doc: PdfDocument }
  | { kind: 'folder-removed'; folder: string }
  | { kind: 'folder-renamed'; from: string; to: string };

type Dlg =
  | { type: 'trash-doc'; doc: PdfDocument }
  | { type: 'rename-doc'; doc: PdfDocument }
  | { type: 'move-doc'; doc: PdfDocument }
  | { type: 'tags'; doc: PdfDocument }
  | { type: 'versions'; doc: PdfDocument }
  | { type: 'trash-folder'; folder: string; title: string; docs: PdfDocument[] }
  | { type: 'rename-folder'; folder: string; docs: PdfDocument[] };

const NEW_FOLDER = '__new__';
const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * Everything you can do to a document or folder from a menu: favourite, rename, move, tags, version history,
 * cover, delete (to the trash). Pages call menuForDoc / menuForFolder and render `dialog` once.
 */
export function useDocActions(documents: PdfDocument[], onChanged: (change: DocChange) => void) {
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const offline = useOffline(); // re-render when books are saved or removed for offline reading
  const { annotations, dropAnnotationsForDoc } = useLibraryStore();

  /** Everything related to a document that this device keeps locally — dropped the moment it is deleted. */
  const purgeLocalFor = async (doc: PdfDocument) => {
    if (offline.has(doc.id)) await removeOffline(doc.id).catch(() => {}); // cached PDF copy
    // Drop its notes & highlights from the list right away; the server moves them to the trash along with the PDF.
    if (annotations.some((a) => a.r2Key === doc.id)) dropAnnotationsForDoc(doc.id);
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const close = useCallback(() => {
    setDlg(null);
    setError(null);
    setProgress('');
  }, []);

  /** Runs `work`, shows its error inside the dialog, closes on success. */
  const run = async (work: () => Promise<void>, change: DocChange, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setDlg(null);
      setProgress('');
      if (done) setNotice(done);
      onChanged(change);
    } catch (err) {
      setError(msg(err, 'Something went wrong'));
      onChanged({ kind: 'changed' }); // a batch may have partly succeeded
    } finally {
      setBusy(false);
    }
  };

  const toggleFavorite = async (doc: PdfDocument) => {
    try {
      await setDocState(doc.id, { favorite: !doc.favorite });
      onChanged({ kind: 'changed' });
    } catch (err) {
      setNotice(msg(err, 'Could not update favourites'));
    }
  };

  const updateCover = async (doc: PdfDocument) => {
    setNotice('Drawing the cover…');
    try {
      await generateCoverFor(doc);
      setNotice('Cover updated');
      onChanged({ kind: 'changed' });
    } catch (err) {
      console.error(err);
      setNotice('Couldn’t draw the cover. Check your connection and try again.');
    }
  };

  const generateCovers = async (docs: PdfDocument[]) => {
    const missing = docs.filter((d) => !d.cover);
    if (missing.length === 0) return setNotice('Every book here already has a cover');
    let drawn = 0;
    for (let i = 0; i < missing.length; i++) {
      setNotice(`Drawing covers… ${i + 1} of ${missing.length}`);
      try {
        await generateCoverFor(missing[i]);
        drawn += 1;
      } catch (err) {
        console.warn('Cover failed for', missing[i].id, err);
      }
    }
    setNotice(drawn ? `Drew ${plural(drawn, 'cover')}` : 'Couldn’t draw covers. Check your connection.');
    onChanged({ kind: 'changed' });
  };

  const toggleOffline = async (doc: PdfDocument) => {
    try {
      if (offline.has(doc.id)) {
        await removeOffline(doc.id);
        setNotice('Offline copy removed');
      } else {
        setNotice('Saving for offline reading…');
        await saveForOffline(doc.id, true);
        setNotice('Saved for offline reading');
      }
    } catch (err) {
      setNotice(msg(err, 'Could not save for offline reading'));
    }
  };

  const menuForDoc = (doc: PdfDocument): MenuEntry[] => [
    { id: 'open', label: 'Open', icon: 'book', to: viewerPath(doc.id) },
    { id: 'favorite', label: doc.favorite ? 'Remove from favourites' : 'Add to favourites', icon: 'star', onSelect: () => void toggleFavorite(doc) },
    { label: offline.has(doc.id) ? 'Remove offline copy' : 'Save for offline', icon: 'download', onSelect: () => void toggleOffline(doc) },
    { heading: 'Organise' },
    { label: 'Rename', icon: 'pen', onSelect: () => setDlg({ type: 'rename-doc', doc }) },
    { label: 'Move to…', icon: 'folder', onSelect: () => setDlg({ type: 'move-doc', doc }) },
    { label: 'Edit tags', icon: 'tag', onSelect: () => setDlg({ type: 'tags', doc }) },
    { heading: 'Cover & files' },
    { label: 'Update cover', icon: 'image', onSelect: () => void updateCover(doc) },
    { label: 'Version history', icon: 'history', onSelect: () => setDlg({ type: 'versions', doc }) },
    { heading: '' },
    { label: 'Delete', icon: 'trash', danger: true, onSelect: () => setDlg({ type: 'trash-doc', doc }) },
  ];

  const menuForFolder = (folder: string, title: string, docs: PdfDocument[]): MenuEntry[] => [
    { label: 'Add files', icon: 'upload', to: `/library?upload=1&folder=${encodeURIComponent(folder)}` },
    { label: 'Draw missing covers', icon: 'image', onSelect: () => void generateCovers(docs) },
    { label: 'Rename folder', icon: 'pen', onSelect: () => setDlg({ type: 'rename-folder', folder, docs }) },
    { label: 'Delete folder', icon: 'trash', danger: true, onSelect: () => setDlg({ type: 'trash-folder', folder, title, docs }) },
  ];

  // ---------------------------------------------------------------- dialogs
  let dialog: ReactNode = null;
  if (dlg?.type === 'trash-doc') {
    const doc = dlg.doc;
    dialog = (
      <ConfirmDialog title="Delete this document?" confirmLabel="Move to trash" busy={busy} error={error} onCancel={close}
        onConfirm={() => void run(async () => { await trashDocument(doc.id); await purgeLocalFor(doc); }, { kind: 'doc-removed', doc }, 'Moved to trash')}>
        <b className="text-gray-900 dark:text-gray-100">{doc.name}</b> moves to the trash with its highlights, notes and backups. You can restore it from
        Trash within 30 days.
      </ConfirmDialog>
    );
  } else if (dlg?.type === 'trash-folder') {
    const { folder, title, docs } = dlg;
    dialog = (
      <ConfirmDialog title="Delete this folder?" confirmLabel="Move to trash" busyLabel={progress || 'Deleting…'} requireText={folder} busy={busy} error={error} onCancel={close}
        onConfirm={() => void run(async () => {
          for (let i = 0; i < docs.length; i++) {
            setProgress(`Deleting ${i + 1} of ${docs.length}…`);
            await trashDocument(docs[i].id);
            await purgeLocalFor(docs[i]); // offline copy, notes and highlights go with each book
          }
        }, { kind: 'folder-removed', folder }, 'Folder moved to trash')}>
        <b className="text-gray-900 dark:text-gray-100">{title}</b> and its {plural(docs.length, 'document')} move to the trash. Each can be restored
        within 30 days.
      </ConfirmDialog>
    );
  } else if (dlg?.type === 'rename-doc') {
    dialog = <RenameDoc doc={dlg.doc} documents={documents} busy={busy} error={error} onCancel={close}
      onSubmit={(name) => void run(async () => { await moveDocument(dlg.doc.id, keyOf(dlg.doc.folder, name)); }, { kind: 'changed', newKey: keyOf(dlg.doc.folder, name) }, 'Renamed')} />;
  } else if (dlg?.type === 'move-doc') {
    const doc = dlg.doc;
    dialog = <MoveDoc doc={doc} documents={documents} busy={busy} error={error} onCancel={close}
      onSubmit={(folder) => void run(async () => { await moveDocument(doc.id, keyOf(folder, doc.id.split('/').pop()!)); }, { kind: 'changed', newKey: keyOf(folder, doc.id.split('/').pop()!) }, `Moved to ${folder}`)} />;
  } else if (dlg?.type === 'tags') {
    const doc = dlg.doc;
    dialog = <TagsDialog doc={doc} suggestions={allTags(documents)} busy={busy} error={error} onCancel={close}
      onSubmit={(tags) => void run(async () => { await setDocState(doc.id, { tags }); }, { kind: 'changed' })} />;
  } else if (dlg?.type === 'versions') {
    const doc = dlg.doc;
    dialog = <Versions doc={doc} onCancel={close} onRestored={() => { close(); setNotice('Earlier version restored'); onChanged({ kind: 'changed' }); }} />;
  } else if (dlg?.type === 'rename-folder') {
    const { folder, docs } = dlg;
    dialog = <RenameFolder folder={folder} count={docs.length} documents={documents} busy={busy} error={error} progress={progress} onCancel={close}
      onSubmit={(name) => void run(async () => {
        for (let i = 0; i < docs.length; i++) {
          setProgress(`Moving ${i + 1} of ${docs.length}…`);
          await moveDocument(docs[i].id, keyOf(name, docs[i].id.split('/').pop()!));
        }
      }, { kind: 'folder-renamed', from: folder, to: name }, 'Folder renamed')} />;
  }

  const toast = notice ? (
    <div role="status" className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-xl dark:bg-gray-100 dark:text-gray-900">{notice}</div>
    </div>
  ) : null;

  return {
    menuForDoc,
    menuForFolder,
    dialog: <>{dialog}{toast}</>,
  };
}

// ====================================================================== dialog bodies

function RenameDoc({ doc, documents, busy, error, onCancel, onSubmit }: { doc: PdfDocument; documents: PdfDocument[]; busy: boolean; error: string | null; onCancel: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(doc.name);
  const trimmed = name.trim();
  const clash = trimmed !== doc.name && documents.some((d) => d.id === keyOf(doc.folder, trimmed));
  const problem = fileNameError(trimmed) ?? (clash ? 'A document with that name already exists here.' : null);
  return (
    <FormDialog title="Rename document" confirmLabel="Rename" busy={busy} error={error} disabled={!!problem || trimmed === doc.name} onCancel={onCancel} onConfirm={() => onSubmit(trimmed)}>
      <span className="field"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Document name" aria-invalid={!!problem} /></span>
      {problem && trimmed !== doc.name && <p role="alert" className="mt-2 text-[13px] text-red-600 dark:text-red-400">{problem}</p>}
    </FormDialog>
  );
}

function FolderPicker({ documents, value, onChange, exclude }: { documents: PdfDocument[]; value: string; onChange: (v: string) => void; exclude?: string }) {
  const folders = useMemo(() => [...new Set(documents.map((d) => d.folder))].filter((f) => f !== exclude).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [documents, exclude]);
  return (
    <label className="field">
      <span className="mute shrink-0">Folder</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Destination folder">
        <option value={NEW_FOLDER}>+ New folder</option>
        {folders.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
    </label>
  );
}

function MoveDoc({ doc, documents, busy, error, onCancel, onSubmit }: { doc: PdfDocument; documents: PdfDocument[]; busy: boolean; error: string | null; onCancel: () => void; onSubmit: (folder: string) => void }) {
  const [choice, setChoice] = useState(NEW_FOLDER);
  const [name, setName] = useState('');
  const isNew = choice === NEW_FOLDER;
  const dest = isNew ? name.trim() : choice;
  const problem = isNew && name ? folderNameError(dest) : null;
  const fileName = doc.id.split('/').pop()!;
  const clash = !!dest && documents.some((d) => d.id === `${dest}/${fileName}`);
  return (
    <FormDialog title="Move document" confirmLabel="Move" busy={busy} error={error} disabled={!dest || !!folderNameError(dest) || dest === doc.folder || clash} onCancel={onCancel} onConfirm={() => onSubmit(dest)}>
      <p className="mute mb-3"><b className="text-gray-900 dark:text-gray-100">{doc.name}</b> is in {doc.folderTitle}. Its highlights, notes and progress move with it.</p>
      <FolderPicker documents={documents} value={choice} onChange={setChoice} exclude={doc.folder} />
      {isNew && <span className="field mt-3"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="New folder name" aria-label="New folder name" aria-invalid={!!problem} maxLength={100} /></span>}
      {(problem || clash) && <p role="alert" className="mt-2 text-[13px] text-red-600 dark:text-red-400">{problem ?? `${dest} already has a file with this name.`}</p>}
    </FormDialog>
  );
}

function RenameFolder({ folder, count, documents, busy, error, progress, onCancel, onSubmit }: { folder: string; count: number; documents: PdfDocument[]; busy: boolean; error: string | null; progress: string; onCancel: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(folder);
  const trimmed = name.trim();
  const exists = trimmed !== folder && documents.some((d) => d.folder === trimmed);
  const problem = trimmed === folder ? null : folderNameError(trimmed) ?? (exists ? 'A folder with that name already exists.' : null);
  return (
    <FormDialog title="Rename folder" confirmLabel="Rename" busy={busy} busyLabel={progress || 'Renaming…'} error={error} disabled={!trimmed || trimmed === folder || !!problem} onCancel={onCancel} onConfirm={() => onSubmit(trimmed)}>
      <p className="mute mb-3">All {plural(count, 'document')} move to the new name, keeping their notes and progress.</p>
      <span className="field"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Folder name" aria-invalid={!!problem} maxLength={100} /></span>
      {problem && <p role="alert" className="mt-2 text-[13px] text-red-600 dark:text-red-400">{problem}</p>}
    </FormDialog>
  );
}

function TagsDialog({ doc, suggestions, busy, error, onCancel, onSubmit }: { doc: PdfDocument; suggestions: string[]; busy: boolean; error: string | null; onCancel: () => void; onSubmit: (tags: string[]) => void }) {
  const [tags, setTags] = useState<string[]>(doc.tags);
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const t = raw.trim().slice(0, 24);
    if (t && tags.length < 12 && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) setTags([...tags, t]);
    setText('');
  };
  const more = suggestions.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase())).slice(0, 8);
  return (
    <FormDialog title="Edit tags" confirmLabel="Save" busy={busy} error={error} onCancel={onCancel} onConfirm={() => onSubmit(text.trim() ? [...tags, text.trim()] : tags)}>
      <p className="mute mb-3">Tags for <b className="text-gray-900 dark:text-gray-100">{doc.name}</b>. Press Enter or comma after each one.</p>
      <div className="mb-2 flex flex-wrap gap-2">
        {tags.map((t) => (
          <button key={t} type="button" className="chip !min-h-9 px-3 text-[13px]" onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>{t} ×</button>
        ))}
      </div>
      <span className="field">
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a tag" aria-label="Add a tag" maxLength={24}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); } else if (e.key === 'Backspace' && !text && tags.length) setTags(tags.slice(0, -1)); }} />
      </span>
      {more.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="mute">Used elsewhere:</span>
          {more.map((s) => <button key={s} type="button" className="chip !min-h-9 px-3 text-[13px]" onClick={() => add(s)}>{s}</button>)}
        </div>
      )}
    </FormDialog>
  );
}

function Versions({ doc, onCancel, onRestored }: { doc: PdfDocument; onCancel: () => void; onRestored: () => void }) {
  const [items, setItems] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    listVersions(doc.id).then((v) => live && setItems(v)).catch((e) => live && setError(msg(e, 'Could not load versions')));
    return () => { live = false; };
  }, [doc.id]);
  const restore = async (v: VersionInfo) => {
    setWorking(v.id);
    setError(null);
    try {
      await restoreVersion(doc.id, v.id);
      onRestored();
    } catch (e) {
      setError(msg(e, 'Could not restore'));
      setWorking(null);
    }
  };
  return (
    <FormDialog title="Version history" error={error} onCancel={onCancel}>
      <p className="mute mb-3">Earlier copies of <b className="text-gray-900 dark:text-gray-100">{doc.name}</b>, saved automatically whenever the file was replaced. The last three are kept.</p>
      {!items ? <p className="mute">Loading…</p> : items.length === 0 ? <p className="mute">No earlier versions yet.</p> : (
        <ul>
          {items.map((v, i) => (
            <li key={v.id} className={`flex items-center gap-3 py-2 ${i ? 'border-t border-gray-100 dark:border-gray-700/60' : ''}`}>
              <div className="min-w-0 flex-1"><div className="font-semibold">{formatDay(v.uploaded)}, {new Date(v.uploaded).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div><div className="mute">{formatSize(v.size)}</div></div>
              <button type="button" className="btn-ghost focus-ring px-3.5 text-[13px]" disabled={!!working} onClick={() => void restore(v)}>{working === v.id ? 'Restoring…' : 'Restore'}</button>
            </li>
          ))}
        </ul>
      )}
    </FormDialog>
  );
}
