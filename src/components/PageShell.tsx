import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { Icon } from './Icon';

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-gray-50 text-gray-900 transition-colors dark:bg-gray-900 dark:text-gray-100">
      <div
        className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 pb-12 sm:px-8"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))' }}
      >
        {children}
      </div>
    </div>
  );
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  return (
    <button type="button" onClick={toggleTheme} className="btn-ghost btn-sq focus-ring" aria-label={label} title={label}>
      <Icon name={theme === 'light' ? 'moon' : 'sun'} />
    </button>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Shows a back button that goes to this route. */
  backTo?: string;
  backLabel?: string;
  /** Extra buttons on the right (before the theme toggle). */
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, backTo, backLabel = 'Back', actions }: PageHeaderProps) {
  return (
    <header className="flex items-center gap-3.5">
      {backTo && (
        <Link to={backTo} className="btn-plain focus-ring -ml-2" aria-label={backLabel} title={backLabel}>
          <Icon name="back" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <div className="mute mt-0.5">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  className = '',
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className={`field ${className}`}>
      <Icon name="search" className="h-[18px] w-[18px] shrink-0 text-gray-500 dark:text-gray-400" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoFocus={autoFocus} />
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  className = '',
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span className="mute shrink-0">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterChips<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Filter">
      {options.map((o) => (
        <button key={o.value} type="button" className="chip focus-ring" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="ml-1.5 font-normal opacity-80">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Notice({
  title,
  children,
  action,
  tone = 'neutral',
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'error';
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={`card flex flex-col items-center gap-2 py-10 text-center ${tone === 'error' ? 'ring-red-300 dark:ring-red-800' : ''}`}
    >
      <div className="text-base font-bold">{title}</div>
      {children && <div className="mute max-w-md">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16" role="status" aria-label="Loading">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600 dark:border-indigo-800 dark:border-t-indigo-400" />
    </div>
  );
}
