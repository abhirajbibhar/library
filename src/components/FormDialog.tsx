import { useEffect, type ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel?: string; // omit for an information-only dialog (only a Close button)
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  disabled?: boolean;
  onConfirm?: () => void;
  onCancel: () => void;
}

/** Modal shell for rename / move / tags / versions. Escape or the backdrop closes it. */
export default function FormDialog({ title, children, confirmLabel, busy, busyLabel = 'Saving…', error, disabled, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-dialog-title"
        className="card max-h-[90vh] w-full max-w-md overflow-y-auto p-6 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (onConfirm && !disabled && !busy) onConfirm();
        }}
      >
        <h2 id="form-dialog-title" className="text-lg font-bold">{title}</h2>
        <div className="mt-3 text-sm">{children}</div>
        {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="btn-ghost focus-ring" onClick={onCancel} disabled={busy}>{confirmLabel ? 'Cancel' : 'Close'}</button>
          {confirmLabel && (
            <button type="submit" className="btn-primary focus-ring" disabled={disabled || busy}>{busy ? busyLabel : confirmLabel}</button>
          )}
        </div>
      </form>
    </div>
  );
}
