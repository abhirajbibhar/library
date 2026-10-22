import { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLibraryStore } from '../store';
import BookGrid from '../components/BookGrid';
import Dropdown from '../components/Dropdown';
import UploadModal from '../components/UploadModal';
import { modKey } from '../lib/platform';
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
  const { books, folders, searchQuery, setSearchQuery, activeFilter, setActiveFilter } = useLibraryStore();
  const { menuFor, dialog } = useBookActions();
  const [params] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState('Recently Added');
  const [showUploadModal, setShowUploadModal] = useState(params.has('upload'));
  const searchStamp = params.get('search');
  const uploadStamp = params.get('upload');
  useEffect(() => {
    if (searchStamp) searchRef.current?.focus();
  }, [searchStamp]);
  useEffect(() => {
    if (uploadStamp) setShowUploadModal(true); // also when PDFs were opened with the installed app
  }, [uploadStamp]);

  // Filter options: everything, favourites, then each folder by its name
  const collectionOptions = useMemo(() => [
    { value: 'all', label: 'All Books' },
    { value: 'fav', label: '★ Favourites' },
    ...folders.map(f => ({ value: `folder:${f.name}`, label: f.name })),
  ], [folders]);

  // A remembered filter can point at a folder that no longer exists; treat that as "All Books"
  const filter = collectionOptions.some((o) => o.value === activeFilter) ? activeFilter : 'all';

  const filteredBooks = useMemo(() => {
    let result = [...books];

    // Filter by search
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(b => 
        b.title.toLowerCase().includes(q) || 
        b.author.toLowerCase().includes(q) ||
        b.genre.toLowerCase().includes(q) ||
        b.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // Filter by collection
    if (filter === 'fav') result = result.filter(b => b.favorite);
    else if (filter.startsWith('folder:')) result = result.filter(b => b.folder === filter.slice(7));

    // Sort
    switch (sortBy) {
      case 'Title A-Z':
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'Author A-Z':
        // Books without an author go last instead of crowding the top of the list
        result.sort((a, b) => Number(!a.author) - Number(!b.author) || a.author.localeCompare(b.author));
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
  }, [books, searchQuery, filter, sortBy]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Library</h1>
          <p className="text-gray-400 mt-1 text-sm sm:text-base">{books.length} {books.length === 1 ? 'book' : 'books'}</p>
        </div>
        <button
          onClick={() => setShowUploadModal(true)}
          aria-label="Add book"
          title="Add book"
          className="p-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors shrink-0"
        >
          <Upload className="w-5 h-5" />
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            ref={searchRef}
            placeholder={`Search books, authors, tags…  (${modKey}+K)`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-800 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* One row on mobile and desktop alike: Collection Filter | Sorting | Grid/List toggle */}
        <div className="flex items-center gap-2">
          {/* Collection Filter Dropdown */}
          <Dropdown
            options={collectionOptions}
            value={filter}
            onChange={setActiveFilter}
            className="flex-1 min-w-0 sm:flex-none sm:min-w-[180px]"
          />

          {/* Sort Dropdown — visible on mobile too */}
          <Dropdown
            options={sortOptions}
            value={sortBy}
            onChange={setSortBy}
            className="flex-1 min-w-0 sm:flex-none sm:min-w-[160px]"
          />

          {/* View toggle (Grid / List) — same compact group at every width */}
          <div className="flex items-center gap-0.5 bg-gray-900 border border-gray-800 rounded-md p-1 shrink-0">
            {([['grid', Grid, 'Grid view'], ['list', List, 'List view']] as const).map(([mode, ViewIcon, label]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                aria-label={label}
                aria-pressed={viewMode === mode}
                title={label}
                className={`p-2 rounded-sm transition-colors ${viewMode === mode ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <ViewIcon className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Books Grid/List */}
      {filteredBooks.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-500 text-lg">No books found</p>
          <p className="text-gray-600 text-sm mt-2">Try adjusting your search or filters</p>
        </div>
      ) : (
        <BookGrid books={filteredBooks} menuFor={menuFor} view={viewMode} />
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <UploadModal
          onClose={() => setShowUploadModal(false)}
          defaultFolder={params.get('folder') ?? (filter.startsWith('folder:') ? filter.slice(7) : undefined)}
        />
      )}
      {dialog}
    </div>
  );
}
