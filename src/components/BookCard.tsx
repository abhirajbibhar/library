import { ArrowDownToLine, Star } from 'lucide-react';
import { useOffline } from '../lib/offline';
import type { Book } from '../types';
import { readingStatus } from '../lib/format';
import BookCover from './BookCover';
import Menu, { type MenuEntry } from './Menu';

interface BookCardProps {
  book: Book;
  onClick?: () => void;
  menu?: MenuEntry[];
}

/**
 * A book as a card: cover on top (rating, favourite and offline marks float over it, a thin progress bar sits on
 * its bottom edge), then title, author, folder and status underneath.
 *
 * The title is a real button stretched over the whole card (`after:absolute after:inset-0`), so the card is
 * keyboard-focusable and announced properly, while the ⋯ menu stays a separate control above it.
 */
export default function BookCard({ book, onClick, menu }: BookCardProps) {
  const offline = useOffline().has(book.r2Key);
  const status = readingStatus(book);
  // The folder has its own chip, so the line under the title is the author, or else the tags.
  const subtitle = book.author || book.tags.join(', ');
  const hasMenu = !!menu && menu.length > 0;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-900 transition duration-200 hover:-translate-y-0.5 hover:border-gray-700 hover:shadow-xl hover:shadow-black/40 focus-within:border-blue-500/60">
      <BookCover book={book} className="aspect-[5/7]">
        {book.rating ? (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-amber-300 backdrop-blur-sm" title={`Rated ${book.rating} out of 5`}>
            <Star className="h-3 w-3 fill-amber-300" aria-hidden="true" />{book.rating}
          </span>
        ) : null}

        {(offline || book.favorite) && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-1 backdrop-blur-sm">
            {offline && <ArrowDownToLine className="h-3.5 w-3.5 text-green-300" aria-label="Available offline" />}
            {book.favorite && <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" aria-label="Favourite" />}
          </span>
        )}

        {book.progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50" role="progressbar" aria-valuenow={book.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Reading progress">
            <div className={`h-full ${book.progress >= 100 ? 'bg-green-400' : 'bg-blue-400'}`} style={{ width: `${book.progress}%` }} />
          </div>
        )}
      </BookCover>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <h3 className="min-h-9 text-[13px] font-semibold leading-snug text-white">
              {onClick ? (
                <button type="button" onClick={onClick} className="line-clamp-2 text-left outline-none transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-blue-200">
                  {book.title}
                </button>
              ) : (
                <span className="line-clamp-2">{book.title}</span>
              )}
            </h3>
            {subtitle && <p className="mt-0.5 line-clamp-1 text-[11px] text-gray-400">{subtitle}</p>}
          </div>
          {hasMenu && (
            <div className="relative z-10 -mr-2 -mt-1.5 shrink-0">
              <Menu label={`Options for ${book.title}`} entries={menu} />
            </div>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="max-w-[60%] truncate rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-300">{book.genre}</span>
          {status && (
            <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${status.className}`}>
              {status.tone === 'reading' ? `${book.progress}%` : status.label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
