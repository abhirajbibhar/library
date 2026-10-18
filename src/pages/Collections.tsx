import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLibraryStore } from '../store';
import { Plus, Trash2, Edit3, X, Check, BookOpen, Folder } from 'lucide-react';

export default function Collections() {
  const { collections, books, addCollection, deleteCollection, updateCollection, addBookToCollection, removeBookFromCollection } = useLibraryStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);

  const handleCreate = (name: string, description: string, color: string) => {
    void addCollection({ name, description, icon: '📁', color });
    setShowCreateModal(false);
  };

  const handleStartEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const handleSaveEdit = (id: string) => {
    updateCollection(id, { name: editName });
    setEditingId(null);
  };

  const activeCollection = collections.find(c => c.id === selectedCollection);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Collections</h1>
          <p className="text-gray-400 mt-1 text-sm sm:text-base">Organize your books into custom shelves</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors self-start"
        >
          <Plus className="w-4 h-4" />
          New Collection
        </button>
      </div>

      {/* Collections Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {collections.map(col => (
          <Link
            key={col.id}
            to={`/collections/${col.id}`}
            className="bg-gray-900 rounded-md border border-gray-800 hover:border-gray-700 p-5 transition-all cursor-pointer group block"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-md flex items-center justify-center" style={{ backgroundColor: `${col.color}20` }}>
                <Folder className="w-5 h-5" style={{ color: col.color }} />
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); handleStartEdit(col.id, col.name); }}
                  className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-white"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteCollection(col.id); }}
                  className="p-1.5 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {editingId === col.id ? (
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                  autoFocus
                />
                <button onClick={() => handleSaveEdit(col.id)} className="p-1 text-green-400 hover:text-green-300">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => setEditingId(null)} className="p-1 text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <h3 className="text-lg font-semibold text-white">{col.name}</h3>
            )}
            
            <p className="text-sm text-gray-400 mt-1">{col.description}</p>
            
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs text-gray-500">{col.bookIds.length} books</span>
              <span className="text-xs text-gray-600">{col.createdAt}</span>
            </div>

            {/* Book covers preview */}
            {col.bookIds.length > 0 && (
              <div className="flex -space-x-2 mt-3">
                {col.bookIds.slice(0, 4).map(bookId => {
                  const book = books.find(b => b.id === bookId);
                  if (!book) return null;
                  return (
                    <div
                      key={bookId}
                      className="w-8 h-10 rounded bg-gradient-to-br from-blue-600 to-purple-600 border border-gray-800 flex items-center justify-center text-xs font-bold text-white/40"
                      title={book.title}
                    >
                      {book.title.charAt(0)}
                    </div>
                  );
                })}
                {col.bookIds.length > 4 && (
                  <div className="w-8 h-10 rounded bg-gray-800 border border-gray-700 flex items-center justify-center text-xs text-gray-400">
                    +{col.bookIds.length - 4}
                  </div>
                )}
              </div>
            )}
          </Link>
        ))}

        {/* Add Collection Card */}
        <div
          onClick={() => setShowCreateModal(true)}
          className="bg-gray-900/50 rounded-md border border-dashed border-gray-800 hover:border-gray-600 p-5 flex flex-col items-center justify-center min-h-[200px] cursor-pointer transition-colors"
        >
          <Plus className="w-8 h-8 text-gray-600 mb-2" />
          <p className="text-sm text-gray-500">Create Collection</p>
        </div>
      </div>

      {/* Collection Detail Modal */}
      {activeCollection && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setSelectedCollection(null)}>
          <div className="bg-gray-900 rounded-md border border-gray-800 p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{activeCollection.icon}</span>
                <div>
                  <h2 className="text-xl font-bold text-white">{activeCollection.name}</h2>
                  <p className="text-sm text-gray-400">{activeCollection.description}</p>
                </div>
              </div>
              <button onClick={() => setSelectedCollection(null)} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Books in collection */}
            <div className="space-y-2">
              {activeCollection.bookIds.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No books in this collection yet</p>
              ) : (
                activeCollection.bookIds.map(bookId => {
                  const book = books.find(b => b.id === bookId);
                  if (!book) return null;
                  return (
                    <div key={bookId} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50">
                      <Link to={`/book/${bookId}`} className="flex items-center gap-3 flex-1" onClick={() => setSelectedCollection(null)}>
                        <BookOpen className="w-5 h-5 text-blue-400" />
                        <div>
                          <p className="text-sm font-medium text-white">{book.title}</p>
                          <p className="text-xs text-gray-400">{book.author}</p>
                        </div>
                      </Link>
                      <button
                        onClick={() => removeBookFromCollection(activeCollection.id, bookId)}
                        className="p-1.5 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Add books */}
            <div className="mt-6 border-t border-gray-800 pt-4">
              <p className="text-xs text-gray-500 mb-2">Add books to this collection:</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {books
                  .filter(b => !activeCollection.bookIds.includes(b.id))
                  .map(book => (
                    <button
                      key={book.id}
                      onClick={() => addBookToCollection(activeCollection.id, book.id)}
                      className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800 text-left transition-colors"
                    >
                      <Plus className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-300">{book.title}</span>
                    </button>
                  ))
                }
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateCollectionModal 
          onClose={() => setShowCreateModal(false)} 
          onCreate={handleCreate} 
        />
      )}
    </div>
  );
}

function CreateCollectionModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, desc: string, color: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('#3b82f6');
  
  const colors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#06b6d4', '#f97316'];

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-md border border-gray-800 p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-white mb-4">Create Collection</h2>
        
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Color</label>
            <div className="flex flex-wrap gap-2">
              {colors.map(c => (
                <button
                  key={c}
                  onClick={() => setIcon(c)}
                  className={`w-10 h-10 rounded-md flex items-center justify-center transition-all ${
                    icon === c ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900 scale-110' : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                >
                  <Folder className="w-5 h-5 text-white/80" />
                </button>
              ))}
            </div>
          </div>
          
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Collection name"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => name && onCreate(name, description, icon as string)}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500 transition-colors disabled:opacity-50"
            disabled={!name}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
