import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

export type MenuEntry =
  /** A group label. An empty heading is just a divider line. */
  | { heading: string }
  | {
      id?: string; // lets a caller hide an entry it already offers elsewhere (e.g. the card's star button)
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

const MOBILE = '(max-width: 639px)';
const MARGIN = 8;

const itemClass = (danger: boolean | undefined, sheet: boolean) =>
  `flex w-full items-center gap-3 rounded-lg px-3 text-left font-medium focus-ring ${sheet ? 'min-h-12 text-[15px]' : 'min-h-10 text-sm'} ${
    danger ? 'text-red-400 hover:bg-red-950/40' : 'text-gray-100 hover:bg-gray-700'
  }`;

/**
 * An icon button that opens a menu.
 *  - Desktop: a popover that sits below the trigger, or above it when that fits better, and follows the page as it
 *    scrolls (it only closes if the trigger scrolls out of view). Scrolling inside the menu never closes it.
 *  - Phones (< sm): a bottom sheet with big tap targets, which also ignores the address bar resizing the viewport.
 *  - Keyboard: focus moves into the menu; ↑ ↓ Home End move between items; Esc closes and returns focus to the button.
 */
export default function Menu({ label, icon = 'more', entries, align = 'right', trigger, badge, buttonClassName = 'btn-plain' }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((refocus = false) => {
    setOpen(false);
    setStyle(null);
    if (refocus) btn.current?.focus();
  }, []);

  const toggle = () => {
    if (open) return close();
    setSheet(window.matchMedia(MOBILE).matches);
    setOpen(true);
  };

  // Popover placement: below if the content fits there, else on whichever side has more room, with a max-height so long menus scroll inside.
  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    if (r.bottom < 0 || r.top > window.innerHeight) return close(); // trigger scrolled out of view
    const below = window.innerHeight - r.bottom - MARGIN;
    const above = r.top - MARGIN;
    const natural = pop.current?.scrollHeight ?? 320;
    const useBelow = below >= Math.min(natural, 320) || below >= above;
    const next: CSSProperties = { maxHeight: Math.max(120, Math.min((useBelow ? below : above) - 4, window.innerHeight * 0.7)) };
    if (useBelow) next.top = r.bottom + 4;
    else next.bottom = window.innerHeight - r.top + 4;
    if (align === 'right') next.right = Math.max(MARGIN, window.innerWidth - r.right);
    else next.left = Math.max(MARGIN, r.left);
    setStyle(next);
  }, [align, close]);

  useLayoutEffect(() => {
    if (open && !sheet) place();
  }, [open, sheet, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && close(true);
    const onScroll = (e: Event) => {
      if (!sheet && !pop.current?.contains(e.target as Node)) place(); // scrolling the menu itself is fine
    };
    const onResize = () => !sheet && place();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, sheet, place, close]);

  // Move focus into the menu once it is on screen
  const ready = open && (sheet || style !== null);
  useEffect(() => {
    if (ready) pop.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [ready]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') return close();
    const items = Array.from(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const last = items.length - 1;
    const next = e.key === 'ArrowDown' ? (i >= last ? 0 : i + 1) : e.key === 'ArrowUp' ? (i <= 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  };

  const renderEntry = (entry: MenuEntry, i: number) => {
    if ('heading' in entry) {
      return entry.heading ? (
        <div key={i} className={`mute px-3 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide ${i > 0 ? 'mt-1 border-t border-white/10' : ''}`}>{entry.heading}</div>
      ) : (
        <div key={i} role="separator" className="my-1 border-t border-white/10" />
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
    const cls = itemClass(entry.danger, sheet);
    if (entry.to) return <Link key={i} to={entry.to} role="menuitem" className={cls} onClick={choose}>{content}</Link>;
    if (entry.href) return <a key={i} href={entry.href} role="menuitem" className={cls} onClick={choose}>{content}</a>;
    if (!entry.onSelect) return <div key={i} className="flex min-h-9 items-center gap-3 px-3 text-sm">{content}</div>;
    return <button key={i} type="button" role="menuitem" className={cls} onClick={choose}>{content}</button>;
  };

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
          sheet ? (
            <>
              <div aria-hidden="true" className="fixed inset-0 z-50 touch-none bg-black/60" />
              <div
                ref={pop}
                id={menuId}
                role="menu"
                aria-label={label}
                onKeyDown={onMenuKey}
                className="animate-fade-in fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-gray-800 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-gray-100 shadow-2xl ring-1 ring-white/10"
              >
                <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/20" />
                <p className="truncate px-3 pb-1 text-xs text-gray-400">{label}</p>
                {entries.map(renderEntry)}
              </div>
            </>
          ) : (
            <div
              ref={pop}
              id={menuId}
              role="menu"
              aria-label={label}
              onKeyDown={onMenuKey}
              style={style ?? { visibility: 'hidden', top: 0, left: 0 }}
              className="fixed z-50 min-w-[220px] max-w-[min(320px,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-xl bg-gray-800 p-1.5 text-gray-100 shadow-xl ring-1 ring-white/15"
            >
              {entries.map(renderEntry)}
            </div>
          ),
          document.body,
        )}
    </>
  );
}
