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

/** A book: its real cover (page 1) or a coloured card with the title's initial, plus progress, rating and a ⋯ menu. */
export default function BookCard({ book, onClick, menu }: BookCardProps) {
  const [broken, setBroken] = useState(false);
  const offline = useOffline().has(book.r2Key);
  const showImage = !!book.cover && !broken;
  // The folder is already shown as the badge below, so the line under the title is the author, or else the tags.
  const subtitle = book.author || book.tags.join(', ');

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer bg-gray-900 rounded-md border border-gray-800 hover:border-gray-700 transition-all duration-200 hover:shadow-xl hover:shadow-blue-500/5 overflow-hidden"
    >
      {/* Cover */}
      <div className="relative aspect-[5/7] flex items-center justify-center overflow-hidden" style={{ backgroundColor: showImage ? '#1f2937' : coverColor(book.title) }}>
        {showImage ? (
          // object-contain: the whole page 1 is visible, nothing is cropped away
          <img src={book.cover} alt="" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-contain" />
        ) : (
          <div className="text-6xl font-bold text-white/25 select-none">{book.title.charAt(0)}</div>
        )}

        {book.favorite && (
          <div className="absolute top-3 right-3 rounded-full bg-black/45 p-1.5 backdrop-blur-sm" title="Favourite">
            <Star className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
          </div>
        )}

        {offline && (
          <div className="absolute bottom-3 left-3 rounded-full bg-black/55 p-1.5 backdrop-blur-sm" title="Available offline">
            <ArrowDownToLine className="w-3 h-3 text-green-300" aria-label="Available offline" />
          </div>
        )}

        {book.rating ? (
          <div className="absolute top-3 left-3 flex gap-0.5 rounded-sm bg-black/35 px-1.5 py-0.5 backdrop-blur-sm">
            {Array.from({ length: book.rating }).map((_, i) => (
              <span key={i} className="text-yellow-300 text-xs">★</span>
            ))}
          </div>
        ) : null}

        {book.progress > 0 && (
          <div className="absolute bottom-3 right-3 px-2 py-0.5 rounded-sm text-xs font-bold bg-black/55 text-white/90 backdrop-blur-sm">
            {book.progress}%
          </div>
        )}
        {book.progress > 0 && (
          <div className="absolute bottom-0 inset-x-0 h-1 bg-black/30">
            <div className="h-full bg-blue-400" style={{ width: `${book.progress}%` }} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-white text-sm line-clamp-1 group-hover:text-blue-300 transition-colors">{book.title}</h3>
            {subtitle && <p className="text-xs text-gray-400 mt-1 truncate">{subtitle}</p>}
          </div>
          {menu && menu.length > 0 && (
            <div className="-mr-2 -mt-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              <Menu label={`Options for ${book.title}`} entries={menu} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-3 gap-2">
          <span className="text-xs px-2 py-0.5 rounded-sm bg-gray-800 text-gray-400 truncate">{book.genre}</span>
          {book.progress >= 100 && <span className="text-xs text-green-400 flex items-center gap-1"><Star className="w-3 h-3 hidden" />Finished</span>}
        </div>
      </div>
    </div>
  );
}
