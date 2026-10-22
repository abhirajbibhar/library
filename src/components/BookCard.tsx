import { ArrowDownToLine, Star } from 'lucide-react';
import { useOffline } from '../lib/offline';
import type { Book } from '../types';
import BookCover from './BookCover';
import Menu, { type MenuEntry } from './Menu';

interface BookCardProps {
  book: Book;
  onClick?: () => void;
  menu?: MenuEntry[];
  /** Shows a one-tap favourite star on the cover (and drops the duplicate entry from the menu). */
  onToggleFavorite?: () => void;
}

// Round, translucent buttons on the cover. On desktop they appear on hover/focus; on touch they are always there.
const coverBtn = 'inline-flex size-8 items-center justify-center rounded-full bg-black/55 text-gray-100 backdrop-blur-sm transition-opacity hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-blue-400';
const hoverOnly = 'sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 aria-expanded:opacity-100';

/**
 * A book as a card: cover on top (rating, favourite and offline marks float over it), then title, author, folder and the percentage read underneath.
 *
 * The title is a real button stretched over the whole card (`after:absolute after:inset-0`), so the card is
 * keyboard-focusable and announced properly, while the star and ⋯ menu are separate controls above it.
 */
export default function BookCard({ book, onClick, menu, onToggleFavorite }: BookCardProps) {
  const offline = useOffline().has(book.r2Key);
  // The folder has its own chip, so the line under the title is the author, or else the tags.
  const subtitle = book.author || book.tags.join(', ');
  // Clicking the card already opens the book, and the star button covers favourites, so the menu doesn't repeat them
  const skip = new Set(['open', ...(onToggleFavorite ? ['favorite'] : [])]);
  const entries = menu?.filter((e) => !('id' in e && e.id && skip.has(e.id)));
  const hasMenu = !!entries && entries.length > 0;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-900 transition duration-200 hover:-translate-y-0.5 hover:border-gray-700 hover:shadow-xl hover:shadow-black/40 focus-within:border-blue-500/60">
      <BookCover book={book} className="aspect-[5/7]">
        {book.rating ? (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-amber-300 backdrop-blur-sm" title={`Rated ${book.rating} out of 5`}>
            <Star className="h-3 w-3 fill-amber-300" aria-hidden="true" />{book.rating}
          </span>
        ) : null}

        {/* Top-right controls, above the stretched title link (relative z-10) */}
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
          {offline && (
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm" title="Available offline">
              <ArrowDownToLine className="h-3.5 w-3.5 text-green-300" aria-label="Available offline" />
            </span>
          )}
          {onToggleFavorite ? (
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-pressed={book.favorite}
              aria-label={book.favorite ? `Remove ${book.title} from favourites` : `Add ${book.title} to favourites`}
              title={book.favorite ? 'Remove from favourites' : 'Add to favourites'}
              className={`${coverBtn} ${book.favorite ? '' : hoverOnly}`}
            >
              <Star className={`h-4 w-4 ${book.favorite ? 'fill-amber-300 text-amber-300' : ''}`} />
            </button>
          ) : (
            book.favorite && <span className="inline-flex size-8 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm" title="Favourite"><Star className="h-4 w-4 fill-amber-300 text-amber-300" aria-label="Favourite" /></span>
          )}
          {hasMenu && <Menu compact label={`Options for ${book.title}`} entries={entries} buttonClassName={`${coverBtn} ${hoverOnly}`} />}
        </div>

      </BookCover>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
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

        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="max-w-[60%] truncate rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-300">{book.genre}</span>
          {book.progress > 0 && (
            <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${book.progress >= 100 ? 'text-green-400' : 'text-blue-300'}`} title={book.progress >= 100 ? 'Finished' : `${book.progress}% read`}>
              {book.progress}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
