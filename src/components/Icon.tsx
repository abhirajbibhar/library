const PATHS = {
  back: 'M15 6l-6 6 6 6',
  search: 'M20 20l-3.5-3.5M11 18a7 7 0 100-14 7 7 0 000 14z',
  upload: 'M12 16V5M7 10l5-5 5 5M5 19h14',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  moon: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z',
  sun: 'M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10l1.4 1.4M3 12h2m14 0h2M5.6 18.4L7 17m10-10l1.4-1.4M16 12a4 4 0 11-8 0 4 4 0 018 0z',
  book: 'M2 5.5C4.5 4 8 4 12 6.5c4-2.5 7.5-2.5 10-1V19c-2.5-1.5-6-1.5-10 1-4-2.5-7.5-2.5-10-1zM12 6.5V20',
  refresh: 'M21 12a9 9 0 11-3-6.7M21 4v5h-5',
  file: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 7.5v5M12 16h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M4 6h16M4 12h16M4 18h16',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  plus: 'M12 5v14M5 12h14',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  disk: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'h-[18px] w-[18px]', filled = false }: { name: IconName; className?: string; filled?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Solid play triangle used by the Resume button. */
export function PlayIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M7 4l13 8-13 8z" />
    </svg>
  );
}
