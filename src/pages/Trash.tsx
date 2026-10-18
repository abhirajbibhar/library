import { useState } from 'react';
import { FileText, RotateCcw, Trash2 } from 'lucide-react';
import { listTrash, purgeTrash, restoreFromTrash } from '../lib/db';
import { useFetch } from '../hooks/useFetch';
import { useLibraryStore } from '../store';
import { formatDay, formatSize, plural } from '../lib/format';
import ConfirmDialog from '../components/ConfirmDialog';
import type { TrashEntry } from '../types';

const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

/** Deleted books stay here for 30 days: restore them or remove them for good. */
export default function Trash() {
  const { refresh } = useLibraryStore();
  const { data, error, loading, reload } = useFetch(() => listTrash());
  const [confirm, setConfirm] = useState<{ type: 'one'; item: TrashEntry } | { type: 'all' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const items = data ?? [];

  const restore = async (item: TrashEntry) => {
    setMessage(null);
    try {
      await restoreFromTrash(item.id);
      setMessage(`Restored “${item.name}” to ${item.folder}`);
      await Promise.all([reload(true), refresh(true)]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not restore');
    }
  };

  const purge = async () => {
    if (!confirm) return;
    setBusy(true);
    setDialogError(null);
    try {
      await purgeTrash(confirm.type === 'one' ? confirm.item.id : undefined);
      setConfirm(null);
      await Promise.all([reload(true), refresh(true)]);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3"><Trash2 className="w-7 h-7 text-gray-400" />Trash</h1>
          <p className="text-gray-400 mt-1 text-sm sm:text-base">{data ? `${plural(items.length, 'book')} · removed for good after 30 days` : 'Deleted books wait here before they are removed for good'}</p>
        </div>
        {items.length > 0 && (
          <button onClick={() => setConfirm({ type: 'all' })} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-red-300 rounded-md text-sm font-medium transition-colors shrink-0">Empty trash</button>
        )}
      </div>

      {message && <p role="status" className="bg-gray-900 border border-gray-800 rounded-md px-4 py-3 text-sm text-gray-200">{message}</p>}

      {error && !data ? (
        <div className="bg-gray-900 rounded-md border border-red-900/50 p-8 text-center" role="alert">
          <p className="text-white font-semibold">Couldn’t load the trash</p>
          <p className="text-gray-400 text-sm mt-1">{error}</p>
          <button onClick={() => void reload()} className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium">Try again</button>
        </div>
      ) : loading && !data ? (
        <div className="py-16 flex justify-center"><div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" role="status" aria-label="Loading" /></div>
      ) : items.length === 0 ? (
        <div className="bg-gray-900 rounded-md border border-gray-800 py-16 text-center">
          <Trash2 className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-white font-semibold">The trash is empty</p>
          <p className="text-gray-500 text-sm mt-1">Books you delete show up here for 30 days.</p>
        </div>
      ) : (
        <ul className="bg-gray-900 rounded-md border border-gray-800 divide-y divide-gray-800">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-10 h-10 rounded-md bg-gray-800 flex items-center justify-center shrink-0"><FileText className="w-5 h-5 text-gray-400" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white truncate">{it.name}</p>
                <p className="text-xs text-gray-500 truncate">{it.folder} · {formatSize(it.size)} · deleted {formatDay(it.deletedAt).toLowerCase()} · {plural(daysLeft(it.expiresAt), 'day')} left</p>
              </div>
              <button onClick={() => void restore(it)} aria-label={`Restore ${it.name}`} title="Restore" className="p-2.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200"><RotateCcw className="w-4 h-4" /></button>
              <button onClick={() => setConfirm({ type: 'one', item: it })} aria-label={`Delete ${it.name} forever`} title="Delete forever" className="p-2.5 rounded-md hover:bg-red-500/10 text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.type === 'all' ? 'Empty the trash?' : 'Delete forever?'}
          confirmLabel={confirm.type === 'all' ? 'Empty trash' : 'Delete forever'}
          busy={busy}
          error={dialogError}
          onConfirm={() => void purge()}
          onCancel={() => { setConfirm(null); setDialogError(null); }}
        >
          {confirm.type === 'all'
            ? `All ${plural(items.length, 'book')} in the trash will be removed for good, with their notes and backups. This can’t be undone.`
            : `“${confirm.item.name}” will be removed for good, with its notes and backups. This can’t be undone.`}
        </ConfirmDialog>
      )}
    </div>
  );
}
