import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLibraryStore } from '../store';
import BookCard from '../components/BookCard';
import Dropdown from '../components/Dropdown';
import Menu from '../components/Menu';
import UploadModal from '../components/UploadModal';
import { useBookActions } from '../hooks/useBookActions';
import { Search, Grid, List, Upload } from 'lucide-react';

const sortOptions = [
  { value: 'Recently Added', label: 'Recently Added' },
  { value: 'Title A-Z', label: 'Title A-Z' },
  { value: 'Author A-Z', label: 'Author A-Z' },
  { value: 'Progress', label: 'Progress' },
  { value: 'Recently Read', label: 'Recently Read' },
  { value: 'Rating', label: 'Rating' },
];

export default function Library() {
  const navigate = useNavigate();
  const { books, collections, searchQuery, setSearchQuery, activeFilter, setActiveFilter } = useLibraryStore();
  const { menuFor, dialog } = useBookActions();
  const [params] = useSearchParams();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState('Recently Added');
  const [showUploadModal, setShowUploadModal] = useState(params.has('upload'));

  // Filter options: everything, favourites, each folder, each collection
  const folderNames = useMemo(() => [...new Set(books.map((b) => b.folder))].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })), [books]);
  const collectionOptions = useMemo(() => [
    { value: 'all', label: 'All Books' },
    { value: 'fav', label: '★ Favourites' },
    ...folderNames.map(f => ({ value: `folder:${f}`, label: `Folder · ${f}` })),
    ...collections.map(c => ({ value: c.id, label: `Collection · ${c.name}` })),
  ], [collections, folderNames]);

  const filteredBooks = useMemo(() => {
    let result = [...books];

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(b => 
        b.title.toLowerCase().includes(q) || 
        b.author.toLowerCase().includes(q) ||
        b.genre.toLowerCase().includes(q) ||
        b.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // Filter by collection
    if (activeFilter === 'fav') result = result.filter(b => b.favorite);
    else if (activeFilter.startsWith('folder:')) result = result.filter(b => b.folder === activeFilter.slice(7));
    else if (activeFilter !== 'all') result = result.filter(b => b.collectionIds.includes(activeFilter));

    // Sort
    switch (sortBy) {
      case 'Title A-Z':
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'Author A-Z':
        result.sort((a, b) => a.author.localeCompare(b.author));
        break;
      case 'Progress':
        result.sort((a, b) => b.progress - a.progress);
        break;
      case 'Recently Read':
        result.sort((a, b) => (b.lastReadAt || '').localeCompare(a.lastReadAt || ''));
        break;
      case 'Rating':
        result.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        break;
      default:
        result.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    }

    return result;
  }, [books, searchQuery, activeFilter, sortBy]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Library</h1>
          <p className="text-gray-400 mt-1 text-sm sm:text-base">{books.length} books in your collection</p>
        </div>
        <button
          onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors self-start"
        >
          <Upload className="w-4 h-4" />
          Add Book
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search books, authors, genres..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-800 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Mobile: Grid | Sort Dropdown | List */}
        {/* Desktop: Collection Dropdown | Sort Dropdown | Grid/List toggle */}
        <div className="flex items-center gap-2">
          {/* Grid toggle - left on mobile, part of group on desktop */}
          <button
            onClick={() => setViewMode('grid')}
            className={`sm:hidden p-2.5 rounded-md border transition-colors ${
              viewMode === 'grid' 
                ? 'bg-gray-700 text-white border-gray-600' 
                : 'bg-gray-900 text-gray-500 border-gray-800'
            }`}
          >
            <Grid className="w-4 h-4" />
          </button>

          {/* Collection Filter Dropdown */}
          <Dropdown
            options={collectionOptions}
            value={activeFilter}
            onChange={setActiveFilter}
            className="flex-1 sm:flex-none sm:min-w-[180px]"
          />

          {/* Sort Dropdown */}
          <Dropdown
            options={sortOptions}
            value={sortBy}
            onChange={setSortBy}
            className="hidden sm:block sm:min-w-[160px]"
          />

          {/* List toggle - right on mobile, part of group on desktop */}
          <button
            onClick={() => setViewMode('list')}
            className={`sm:hidden p-2.5 rounded-md border transition-colors ${
              viewMode === 'list' 
                ? 'bg-gray-700 text-white border-gray-600' 
                : 'bg-gray-900 text-gray-500 border-gray-800'
            }`}
          >
            <List className="w-4 h-4" />
          </button>

          {/* Desktop view toggle group */}
          <div className="hidden sm:flex items-center gap-0.5 bg-gray-900 border border-gray-800 rounded-md p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-sm ${viewMode === 'grid' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-sm ${viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Books Grid/List */}
      {filteredBooks.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-500 text-lg">No books found</p>
          <p className="text-gray-600 text-sm mt-2">Try adjusting your search or filters</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredBooks.map(book => (
            <BookCard key={book.id} book={book} menu={menuFor(book)} onClick={() => navigate(`/book/${book.id}`)} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredBooks.map(book => (
            <div
              key={book.id}
              onClick={() => navigate(`/book/${book.id}`)}
              className="flex items-center gap-4 p-4 bg-gray-900 rounded-md border border-gray-800 hover:border-gray-700 cursor-pointer transition-colors"
            >
              <div className="w-12 h-12 rounded-md overflow-hidden flex items-center justify-center text-xl font-bold text-white/40 flex-shrink-0 bg-gray-800">
                {book.cover ? <img src={book.cover} alt="" loading="lazy" className="w-full h-full object-cover" /> : book.title.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-white truncate">{book.title}</h3>
                <p className="text-xs text-gray-400">{book.author ? `${book.author} · ` : ''}{book.genre}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs text-gray-400">{book.pages ? `${book.pages} pages` : 'Not opened yet'}</p>
                {book.progress > 0 && (
                  <p className="text-xs text-blue-400">{book.progress}% read</p>
                )}
              </div>
              <div className="shrink-0 -mr-2" onClick={(e) => e.stopPropagation()}>
                <Menu label={`Options for ${book.title}`} entries={menuFor(book)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <UploadModal
          onClose={() => setShowUploadModal(false)}
          defaultFolder={activeFilter.startsWith('folder:') ? activeFilter.slice(7) : undefined}
        />
      )}
      {dialog}
    </div>
  );
}
