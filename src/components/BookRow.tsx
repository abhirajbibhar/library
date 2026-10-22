import type { Book } from '../types';
import { readingStatus } from '../lib/format';
import BookCover from './BookCover';
import Menu, { type MenuEntry } from './Menu';

/** The list-view twin of BookCard (same stretched-title trick, same status logic). */
export default function BookRow({ book, onClick, menu }: { book: Book; onClick: () => void; menu?: MenuEntry[] }) {
  const status = readingStatus(book);
  const subtitle = [book.author, book.genre].filter(Boolean).join(' · ');

  return (
    <div className="group relative flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 p-3 transition-colors hover:border-gray-700 focus-within:border-blue-500/60">
      <BookCover book={book} className="w-10 shrink-0 rounded-md aspect-[5/7]" letterClassName="text-lg" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium text-white">
          <button type="button" onClick={onClick} className="max-w-full truncate text-left outline-none after:absolute after:inset-0 after:content-['']">{book.title}</button>
        </h3>
        <p className="truncate text-xs text-gray-400">{subtitle}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs text-gray-400">{book.pages ? `${book.pages} pages` : 'Not opened yet'}</p>
        {status && <p className={`text-xs ${status.tone === 'finished' ? 'text-green-300' : status.tone === 'reading' ? 'text-blue-300' : 'text-gray-500'}`}>{status.tone === 'reading' ? `${book.progress}% read` : status.label}</p>}
      </div>
      {menu && menu.length > 0 && (
        <div className="relative z-10 -mr-2 shrink-0">
          <Menu compact label={`Options for ${book.title}`} entries={menu} />
        </div>
      )}
    </div>
  );
}
