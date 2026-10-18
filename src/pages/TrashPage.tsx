import { useState } from 'react';
import { listTrash, purgeTrash, restoreFromTrash } from '../lib/db';
import { useFetch } from '../hooks/useFetch';
import { formatDay, formatSize, plural } from '../lib/format';
import ConfirmDialog from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import Menu from '../components/Menu';
import { Notice, PageHeader, PageShell, Spinner } from '../components/PageShell';
import type { TrashEntry } from '../types';

const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

/** Deleted documents stay here for 30 days: restore them or remove them for good. */
export default function TrashPage() {
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
      void reload(true);
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
      void reload(true);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Trash"
        backTo="/"
        backLabel="Back to Home"
        subtitle={data ? `${plural(items.length, 'document')} · removed for good after 30 days` : undefined}
        actions={
          items.length > 0 && (
            <Menu label="Trash options" entries={[{ label: 'Empty trash', icon: 'trash', danger: true, onSelect: () => setConfirm({ type: 'all' }) }]} />
          )
        }
      />

      {message && <p role="status" className="card py-3 text-sm">{message}</p>}

      {error && !data ? (
        <Notice tone="error" title="Couldn’t load the trash" action={<button className="btn-primary" onClick={() => void reload()}>Try again</button>}>{error}</Notice>
      ) : loading && !data ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Notice title="The trash is empty">Documents you delete show up here for 30 days, so you can bring them back.</Notice>
      ) : (
        <ul className="card p-0">
          {items.map((it, i) => (
            <li key={it.id} className={`flex items-center gap-3 px-4 py-3 ${i ? 'border-t border-gray-100 dark:border-gray-700/60' : ''}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300"><Icon name="file" className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{it.name}</div>
                <div className="mute truncate">{it.folder} · {formatSize(it.size)} · deleted {formatDay(it.deletedAt).toLowerCase()} · {plural(daysLeft(it.expiresAt), 'day')} left</div>
              </div>
              <button type="button" className="btn-ghost btn-sq focus-ring" aria-label={`Restore ${it.name}`} title="Restore" onClick={() => void restore(it)}><Icon name="rotate" /></button>
              <Menu label={`Options for ${it.name}`} entries={[{ label: 'Delete forever', icon: 'trash', danger: true, onSelect: () => setConfirm({ type: 'one', item: it }) }]} />
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
            ? `All ${plural(items.length, 'document')} in the trash will be removed for good, with their notes and backups. This can’t be undone.`
            : `“${confirm.item.name}” will be removed for good, with its notes and backups. This can’t be undone.`}
        </ConfirmDialog>
      )}
    </PageShell>
  );
}
