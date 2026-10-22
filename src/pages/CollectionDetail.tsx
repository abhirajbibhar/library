import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Folder, Plus } from 'lucide-react';
import { useLibraryStore } from '../store';
import { useBookActions } from '../hooks/useBookActions';
import { coverColor, plural } from '../lib/format';
import BookCard from '../components/BookCard';
import Menu from '../components/Menu';
import UploadModal from '../components/UploadModal';

/** One folder (collection): its books, with add, rename and delete. */
export default function CollectionDetail() {
  const { id: name = '' } = useParams(); // the folder name (the router has already decoded it)
  const navigate = useNavigate();
  const { books } = useLibraryStore();
  const { menuFor, menuForFolder, dialog } = useBookActions((c) => {
    if (c.kind === 'folder-removed') navigate('/collections', { replace: true });
    else if (c.kind === 'folder-renamed') navigate(`/collections/${encodeURIComponent(c.to)}`, { replace: true });
  });
  const [adding, setAdding] = useState(false);

  const list = books.filter((b) => b.folder === name);

  if (list.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400">This collection is empty or doesn’t exist</p>
        <Link to="/collections" className="text-blue-400 mt-4 inline-block">Back to Collections</Link>
      </div>
    );
  }

  const finished = list.filter((b) => b.progress >= 100).length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `${coverColor(name)}33` }}>
          <Folder className="w-6 h-6" style={{ color: coverColor(name) }} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-white truncate">{name}</h1>
          <p className="text-sm text-gray-400">{plural(list.length, 'book')}{finished ? ` · ${finished} finished` : ''}</p>
        </div>
        <button onClick={() => setAdding(true)} aria-label="Add books" title="Add books" className="p-2.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors"><Plus className="w-5 h-5" /></button>
        <Menu label="Collection options" entries={menuForFolder(name)} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
        {list.map((book) => (
          <BookCard key={book.id} book={book} menu={menuFor(book)} onClick={() => navigate(`/book/${book.id}`)} />
        ))}
      </div>

      {adding && <UploadModal onClose={() => setAdding(false)} defaultFolder={name} />}
      {dialog}
    </div>
  );
}
