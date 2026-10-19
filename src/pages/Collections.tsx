import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Folder, Plus } from 'lucide-react';
import { useLibraryStore } from '../store';
import { useBookActions } from '../hooks/useBookActions';
import { coverColor, plural } from '../lib/format';
import Menu from '../components/Menu';
import UploadModal from '../components/UploadModal';

/** Every folder is a collection. Making a new collection means adding books to a new folder. */
export default function Collections() {
  const { folders } = useLibraryStore();
  const { menuForFolder, dialog } = useBookActions();
  const [adding, setAdding] = useState(false);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Collections</h1>
        <button onClick={() => setAdding(true)} aria-label="New collection" title="New collection"
          className="p-2.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors">
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {folders.length === 0 ? (
        <div className="bg-gray-900 rounded-md border border-gray-800 py-16 text-center">
          <Folder className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-white font-semibold">No collections yet</p>
          <p className="text-gray-500 text-sm mt-1">Add books to a new folder and it appears here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {folders.map((f) => (
            <div key={f.name} className="relative bg-gray-900 rounded-md border border-gray-800 hover:border-gray-700 transition-colors">
              <Link to={`/collections/${encodeURIComponent(f.name)}`} className="block p-5 pr-14">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `${coverColor(f.name)}33` }}>
                    <Folder className="w-5 h-5" style={{ color: coverColor(f.name) }} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-white truncate">{f.name}</h2>
                    <p className="text-xs text-gray-400">{plural(f.count, 'book')}{f.finished ? ` · ${f.finished} finished` : ''}</p>
                  </div>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden mt-4" role="img" aria-label={`${f.progress} percent read on average`}>
                  <div className="h-full bg-blue-500" style={{ width: `${f.progress}%` }} />
                </div>
              </Link>
              <div className="absolute top-3 right-2"><Menu label={`Options for ${f.name}`} entries={menuForFolder(f.name)} /></div>
            </div>
          ))}
        </div>
      )}

      {adding && <UploadModal onClose={() => setAdding(false)} />}
      {dialog}
    </div>
  );
}
