import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

export type MenuEntry =
  | { heading: string }
  | {
      label: string;
      icon?: IconName;
      to?: string; // in-app route
      href?: string; // full page link
      onSelect?: () => void;
      checked?: boolean; // shows a tick (for choose-one lists)
      danger?: boolean;
      meta?: string; // quiet text on the right; with no action the row is just information
      keepOpen?: boolean;
    };

interface MenuProps {
  label: string;
  icon?: IconName;
  entries: MenuEntry[];
  align?: 'left' | 'right';
  /** Replaces the icon button, e.g. for a text trigger. */
  trigger?: ReactNode;
  /** Small dot on the button, e.g. when a filter is active. */
  badge?: boolean;
  buttonClassName?: string;
}

const itemClass = (danger?: boolean) =>
  `flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium focus-ring ${
    danger ? 'text-red-400 hover:bg-red-950/40' : 'text-gray-100 hover:bg-gray-700'
  }`;

/** An icon button that opens a small dropdown. Closes on outside click, Escape or after a choice. */
export default function Menu({ label, icon = 'more', entries, align = 'right', trigger, badge, buttonClassName = 'btn-plain' }: MenuProps) {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = pos !== null;
  const close = () => setPos(null);

  const toggle = () => {
    if (open) return close();
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    // Fixed + portal so menus are never clipped by scrolling rows or cards; flips upward near the bottom.
    const below = window.innerHeight - r.bottom;
    const style: CSSProperties = below < 300 && r.top > below ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 };
    if (align === 'right') style.right = Math.max(8, window.innerWidth - r.right);
    else style.left = Math.max(8, r.left);
    setPos(style);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPos(null);
        btn.current?.focus();
      }
    };
    // The menu is fixed-position, so any scroll or resize would leave it floating away from its trigger: close it.
    const onMove = () => setPos(null);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`${buttonClassName} focus-ring relative`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        {trigger ?? <Icon name={icon} />}
        {badge && <span aria-hidden="true" className="absolute right-2 top-2 h-2 w-2 rounded-full bg-blue-400" />}
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            id={menuId}
            role="menu"
            style={pos ?? undefined}
            className="fixed z-50 max-h-[70vh] min-w-[220px] max-w-[min(320px,calc(100vw-1rem))] overflow-y-auto rounded-xl bg-gray-800 p-1.5 text-gray-100 shadow-xl ring-1 ring-white/15"
          >
            {entries.map((entry, i) => {
              if ('heading' in entry) {
                return (
                  <div key={i} className="mute px-3 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide">
                    {entry.heading}
                  </div>
                );
              }
              const content = (
                <>
                  {entry.icon && <Icon name={entry.icon} className="h-[18px] w-[18px] shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.meta && <span className="mute shrink-0 font-normal">{entry.meta}</span>}
                  {entry.checked && <Icon name="check" className="h-4 w-4 shrink-0 text-blue-400" />}
                </>
              );
              const choose = () => {
                if (!entry.keepOpen) close();
                entry.onSelect?.();
              };
              if (entry.to) return <Link key={i} to={entry.to} role="menuitem" className={itemClass(entry.danger)} onClick={choose}>{content}</Link>;
              if (entry.href) return <a key={i} href={entry.href} role="menuitem" className={itemClass(entry.danger)} onClick={choose}>{content}</a>;
              if (!entry.onSelect) return <div key={i} className="flex min-h-9 items-center gap-3 px-3 text-sm">{content}</div>;
              return (
                <button key={i} type="button" role="menuitem" className={itemClass(entry.danger)} onClick={choose}>
                  {content}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
