import { useCallback, useState, type ReactNode } from 'react';
import { deleteDocument, deleteFolder } from '../lib/db';
import type { PdfDocument } from '../types';
import { plural } from '../lib/format';
import ConfirmDialog from '../components/ConfirmDialog';

type Target = { kind: 'doc'; doc: PdfDocument } | { kind: 'folder'; folder: string; title: string; count: number };

/**
 * Delete flow shared by every page: call askDeleteDoc / askDeleteFolder from a menu,
 * render `dialog` somewhere in the page. `onDone` runs after a successful delete (reload or navigate).
 */
export function useDeleteActions(onDone: (target: Target) => void): {
  askDeleteDoc: (doc: PdfDocument) => void;
  askDeleteFolder: (folder: string, title: string, count: number) => void;
  dialog: ReactNode;
} {
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setTarget(null);
    setError(null);
  }, []);

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      if (target.kind === 'doc') await deleteDocument(target.doc.id);
      else await deleteFolder(target.folder);
      const done = target;
      setTarget(null);
      onDone(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setBusy(false);
    }
  };

  const dialog = target ? (
    target.kind === 'doc' ? (
      <ConfirmDialog title="Delete this document?" confirmLabel="Delete" busy={busy} error={error} onConfirm={() => void confirm()} onCancel={close}>
        <b className="text-gray-900 dark:text-gray-100">{target.doc.name}</b> will be removed from {target.doc.folderTitle}, along with its
        highlights, notes, reading progress and backups. This can’t be undone.
      </ConfirmDialog>
    ) : (
      <ConfirmDialog title="Delete this folder?" confirmLabel="Delete folder" requireText={target.folder} busy={busy} error={error} onConfirm={() => void confirm()} onCancel={close}>
        <b className="text-gray-900 dark:text-gray-100">{target.title}</b> and its {plural(target.count, 'document')} will be removed, along with every
        highlight, note and backup inside. This can’t be undone.
      </ConfirmDialog>
    )
  ) : null;

  return {
    askDeleteDoc: (doc) => setTarget({ kind: 'doc', doc }),
    askDeleteFolder: (folder, title, count) => setTarget({ kind: 'folder', folder, title, count }),
    dialog,
  };
}
