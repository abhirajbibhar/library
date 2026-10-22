import { useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../store';
import type { Book } from '../types';
import BookCard from './BookCard';
import BookRow from './BookRow';
import type { MenuEntry } from './Menu';

interface BookGridProps {
  books: Book[];
  menuFor: (book: Book) => MenuEntry[];
  view?: 'grid' | 'list';
}

/** Every page that shows books (dashboard shelves, library, collections) renders them through this. */
export default function BookGrid({ books, menuFor, view = 'grid' }: BookGridProps) {
  const navigate = useNavigate();
  const { toggleFavorite, showNotice } = useLibraryStore();
  const open = (b: Book) => () => navigate(`/book/${b.id}`);

  if (view === 'list') {
    return <div className="space-y-2">{books.map((b) => <BookRow key={b.id} book={b} menu={menuFor(b)} onClick={open(b)} />)}</div>;
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {books.map((b) => <BookCard key={b.id} book={b} menu={menuFor(b)} onClick={open(b)} onToggleFavorite={() => void toggleFavorite(b.id).catch(() => showNotice('Could not update favourites'))} />)}
    </div>
  );
}
