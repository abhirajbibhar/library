import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleAlert,
  Clock,
  Ellipsis,
  FileText,
  Folder,
  HardDrive,
  LayoutGrid,
  List,
  LogOut,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sun,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react';

// Lucide icons drawn at a light 1.5 stroke. Pages refer to icons by name, so the set can be swapped in one place.
const ICONS = {
  back: ArrowLeft,
  search: Search,
  upload: Upload,
  logout: LogOut,
  moon: Moon,
  sun: Sun,
  book: BookOpen,
  refresh: RefreshCw,
  file: FileText,
  check: Check,
  alert: CircleAlert,
  clock: Clock,
  grid: LayoutGrid,
  list: List,
  arrow: ArrowRight,
  more: Ellipsis,
  trash: Trash2,
  sliders: SlidersHorizontal,
  folder: Folder,
  plus: Plus,
  pen: Pencil,
  disk: HardDrive,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className = 'h-[18px] w-[18px]', filled = false }: { name: IconName; className?: string; filled?: boolean }) {
  const Glyph = ICONS[name];
  return <Glyph aria-hidden="true" className={className} strokeWidth={1.5} fill={filled ? 'currentColor' : 'none'} />;
}

/** Solid play triangle used by the Resume button. */
export function PlayIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M7 4l13 8-13 8z" />
    </svg>
  );
}
