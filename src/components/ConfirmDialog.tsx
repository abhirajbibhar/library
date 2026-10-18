import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** The person must type this exactly before the button enables (used for whole folders). */
  requireText?: string;
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A modal confirmation for destructive actions. Escape or the backdrop cancels. */
export default function ConfirmDialog({ title, children, confirmLabel, requireText, busy, busyLabel = 'Deleting…', error, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ok = !requireText || typed === requireText;

  useEffect(() => {
    (requireText ? inputRef : cancelRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel, requireText]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="card w-full max-w-md p-6 shadow-2xl">
        <h2 id="confirm-title" className="text-lg font-bold">{title}</h2>
        <div className="mute mt-2 text-sm leading-relaxed">{children}</div>
        {requireText && (
          <label className="mt-4 block">
            <span className="mute mb-1.5 block">Type <b className="text-gray-900 dark:text-gray-100">{requireText}</b> to confirm</span>
            <span className="field">
              <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label={`Type ${requireText} to confirm`} />
            </span>
          </label>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button ref={cancelRef} type="button" className="btn-ghost focus-ring" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn-danger focus-ring" onClick={onConfirm} disabled={!ok || busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
