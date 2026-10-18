import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLibraryStore } from '../store';
import BookCard from '../components/BookCard';
import { useBookActions } from '../hooks/useBookActions';
import { Plus, Edit3, Trash2, Folder } from 'lucide-react';

export default function CollectionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { collections, books, deleteCollection, updateCollection, removeBookFromCollection } = useLibraryStore();
  const { menuFor, dialog } = useBookActions();

  const collection = collections.find(c => c.id === id);

  if (!collection) {
    return (
      <div className="max-w-6xl mx-auto text-center py-20">
        <p className="text-gray-400 text-lg">Collection not found</p>
        <Link to="/collections" className="text-blue-400 mt-4 inline-block hover:text-blue-300">
          Back to Collections
        </Link>
      </div>
    );
  }

  const collectionBooks = books.filter(book => collection.bookIds.includes(book.id));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${collection.color}20` }}>
            <Folder className="w-7 h-7 sm:w-8 sm:h-8" style={{ color: collection.color }} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-white truncate">{collection.name}</h1>
            <p className="text-gray-400 mt-1 text-sm sm:text-base">{collection.description}</p>
            <p className="text-sm text-gray-500 mt-2">
              {collectionBooks.length} {collectionBooks.length === 1 ? 'book' : 'books'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start">
          <button
            onClick={() => {
              const name = window.prompt('Rename collection', collection.name)?.trim();
              if (name && name !== collection.name) void updateCollection(collection.id, { name });
            }}
            aria-label="Rename collection"
            title="Rename collection"
            className="p-2 rounded-md hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
          >
            <Edit3 className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
              if (confirm('Delete this collection?')) {
                deleteCollection(collection.id);
                navigate('/collections');
              }
            }}
            className="p-2 rounded-md hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Books Grid */}
      {collectionBooks.length === 0 ? (
        <div className="bg-gray-900 rounded-md border border-gray-800 p-12 text-center">
          <p className="text-gray-400 mb-4">This collection is empty</p>
          <Link
            to="/library"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Books
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {collectionBooks.map(book => (
            <BookCard key={book.id} book={book} menu={[{ label: 'Remove from collection', icon: 'folder', onSelect: () => void removeBookFromCollection(collection.id, book.id) }, ...menuFor(book)]} onClick={() => navigate(`/book/${book.id}`)} />
          ))}
        </div>
      )}
      {dialog}
    </div>
  );
}
