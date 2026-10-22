import { useEffect, useState, type ReactNode } from 'react';
import type { Book } from '../types';
import { coverColor } from '../lib/format';

interface BookCoverProps {
  book: Pick<Book, 'title' | 'cover'>;
  /** `cover` fills the frame (cards); `contain` shows the whole page (detail hero). */
  fit?: 'cover' | 'contain';
  className?: string;
  letterClassName?: string;
  alt?: string;
  children?: ReactNode;
}

/**
 * The one place a book's cover is drawn: the real page-1 image, or a coloured tile with the title's initial
 * when there is none (or it fails to load). Used by the card, list row, detail page and Notes groups.
 */
export default function BookCover({ book, fit = 'cover', className = '', letterClassName = 'text-6xl', alt = '', children }: BookCoverProps) {
  const [broken, setBroken] = useState(false);
  // A new cover URL (e.g. after the cover is regenerated) deserves a fresh try
  useEffect(() => setBroken(false), [book.cover]);
  const showImage = !!book.cover && !broken;

  return (
    <div className={`relative flex items-center justify-center overflow-hidden ${className}`} style={{ backgroundColor: showImage ? '#1f2937' : coverColor(book.title) }}>
      {showImage ? (
        <img
          src={book.cover}
          alt={alt}
          loading="lazy"
          onError={() => setBroken(true)}
          className={`absolute inset-0 h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
        />
      ) : (
        <span aria-hidden="true" className={`select-none font-bold text-white/25 ${letterClassName}`}>{book.title.charAt(0)}</span>
      )}
      {children}
    </div>
  );
}
