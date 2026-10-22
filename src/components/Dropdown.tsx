import { useState, useRef, useEffect, useLayoutEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * A select-style dropdown. The list is rendered in a fixed-position portal so it is never clipped by
 * scrolling parents, flips upward near the bottom of the viewport, stays inside the screen edges and
 * scrolls on its own when there are many options. It also follows page scroll/resize while open.
 */
export default function Dropdown({ options, value, onChange, placeholder, className = '' }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Place the panel against the trigger: below if there's room, otherwise flipped above.
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    const wantH = Math.min(280, 44 + options.length * 40); // rough panel height for flip decisions
    const flip = below < wantH && above > below;
    const style: CSSProperties = { width: r.width, minWidth: 160 };
    if (flip) style.bottom = window.innerHeight - r.top + 4;
    else style.top = r.bottom + 4;
    // Keep it within the horizontal viewport bounds.
    style.left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - r.width - 8));
    setPos(style);
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    place();
    // Re-position on scroll/resize so the panel never drifts away from the trigger.
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, options.length]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setIsOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  // Scroll the current selection into view when opening.
  useEffect(() => {
    if (isOpen) listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [isOpen]);

  return (
    <div className={`relative ${className}`}>
      {/* Button */}
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-md text-sm text-gray-300 hover:border-gray-700 focus:outline-none focus:border-blue-500 transition-colors"
      >
        <span className="truncate">
          {selectedOption ? selectedOption.label : placeholder || 'Select...'}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown Menu — fixed + portal: never clipped, flips near viewport edges */}
      {isOpen &&
        pos &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            style={{ position: 'fixed', zIndex: 60, ...pos }}
            className="bg-gray-900 border border-gray-800 rounded-md shadow-xl shadow-black/40 py-1 max-h-[min(280px,60vh)] overflow-y-auto overscroll-contain"
          >
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-selected={active}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm transition-colors ${
                    active ? 'bg-blue-500/10 text-blue-400' : 'text-gray-300 hover:bg-gray-800'
                  }`}
                >
                  <span className="w-4 flex-shrink-0">{active && <Check className="w-4 h-4" />}</span>
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
