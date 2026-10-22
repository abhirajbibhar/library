import { ArrowDownToLine, Star } from 'lucide-react';
import { useOffline } from '../lib/offline';
import { useState } from 'react';
import { Book } from '../types';
import { coverColor } from '../lib/format';
import Menu, { type MenuEntry } from './Menu';

interface BookCardProps {
  book: Book;
  onClick?: () => void;
  menu?: MenuEntry[];
}

/** Reading status shown as a small badge on the cover. */
export function readingStatus(b: Book): { label: string; className: string } | null {
  if (b.progress >= 100) return { label: 'Finished', className: 'bg-green-500/20 text-green-300 border-green-500/30' };
  if (b.progress > 0) return { label: 'Reading', className: 'bg-blue-500/20 text-blue-300 border-blue-500/30' };
  if (b.lastReadAt) return { label: 'Started', className: 'bg-gray-500/20 text-gray-300 border-gray-500/30' };
  return null;
}

/**
 * A book: its real cover (page 1) or a coloured card with the title's initial. The cover stays clean —
 * only small status badges float over it — while the meta (title, author, folder, progress, options menu)
 * lives in a compact footer below the image with a soft gradient fade into the cover, keeping cards short.
 */
export default function BookCard({ book, onClick, menu }: BookCardProps) {
  const [broken, setBroken] = useState(false);
  const offline = useOffline().has(book.r2Key);
  const showImage = !!book.cover && !broken;
  // The folder shows as a badge in the footer, so the line under the title is the author, or else the tags.
  const subtitle = book.author || book.tags.join(', ');
  const status = readingStatus(book);

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer bg-gray-900 rounded-md border border-gray-800 hover:border-gray-700 transition-all duration-200 hover:shadow-xl hover:shadow-blue-500/5 overflow-hidden flex flex-col"
    >
      {/* Cover — kept clean; a thin gradient at its bottom edge fades into the footer */}
      <div className="relative aspect-[3/4] flex items-center justify-center overflow-hidden" style={{ backgroundColor: showImage ? '#1f2937' : coverColor(book.title) }}>
        {showImage ? (
          <img src={book.cover} alt="" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="text-6xl font-bold text-white/25 select-none">{book.title.charAt(0)}</div>
        )}

        {/* Top-row badges: rating (left), favourite + offline (right) */}
        <div className="absolute top-2 inset-x-2 flex items-start justify-between gap-2 pointer-events-none">
          {book.rating ? (
            <div className="flex gap-0.5 rounded-sm bg-black/45 px-1.5 py-0.5 backdrop-blur-sm">
              {Array.from({ length: book.rating }).map((_, i) => (
                <span key={i} className="text-yellow-300 text-xs">★</span>
              ))}
            </div>
          ) : <span />}
          <div className="flex items-center gap-1.5">
            {offline && (
              <div className="rounded-full bg-black/55 p-1.5 backdrop-blur-sm" title="Available offline">
                <ArrowDownToLine className="w-3 h-3 text-green-300" aria-label="Available offline" />
              </div>
            )}
            {book.favorite && (
              <div className="rounded-full bg-black/45 p-1.5 backdrop-blur-sm" title="Favourite">
                <Star className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
              </div>
            )}
          </div>
        </div>

        {/* Reading-status badge floats over the cover's bottom-right corner */}
        {status && (
          <span className={`absolute bottom-2 right-2 z-10 text-[10px] px-1.5 py-0.5 rounded-sm border backdrop-blur-sm ${status.className}`}>
            {status.label}
          </span>
        )}

        {/* Soft fade from the cover into the footer — the "little overlay" that ties them together */}
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-gray-900/90 to-transparent pointer-events-none" aria-hidden="true" />
      </div>

      {/* Footer — title, author, folder, progress and the options menu live here, in small type */}
      <div className="p-2.5 -mt-1">
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-white text-[13px] leading-snug line-clamp-1 group-hover:text-blue-200 transition-colors">{book.title}</h3>
            {subtitle && <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{subtitle}</p>}
          </div>
          {menu && menu.length > 0 && (
            <div className="-mr-1.5 -mt-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              <Menu label={`Options for ${book.title}`} entries={menu} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-1.5 gap-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-white/5 text-gray-300 border border-white/10 truncate max-w-[65%]">{book.genre}</span>
          {book.progress > 0 && <span className="text-[10px] text-gray-400 shrink-0">{book.progress}%</span>}
        </div>

        {book.progress > 0 && (
          <div className="mt-1.5 h-0.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-blue-400" style={{ width: `${book.progress}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
