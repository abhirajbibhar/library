import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { PdfDocument } from '../types';
import { getLibrary } from '../lib/db';
import { useTheme } from '../contexts/ThemeContext';
import { HOME_URL, LOGOUT_URL } from '../config';

// Don't hammer the worker (each list call = several R2 operations) when focus/visibility events fire.
const AUTO_REFRESH_MIN_INTERVAL_MS = 15_000;

const isFinished = (d: PdfDocument) => d.totalPages > 0 && d.lastPage >= d.totalPages;

export default function LibraryPage() {
  const [documents, setDocuments] = useState<PdfDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const { theme, toggleTheme } = useTheme();

  // Only the newest request may update state (older, slower responses used to overwrite newer ones).
  const requestIdRef = useRef(0);
  const lastLoadStartedRef = useRef(0);

  const loadLibrary = useCallback(async (silent = false) => {
    const requestId = ++requestIdRef.current;
    lastLoadStartedRef.current = Date.now();
    if (!silent) setLoading(true);
    try {
      const docs = await getLibrary();
      if (requestId !== requestIdRef.current) return;
      setDocuments(docs);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error('Failed to load library:', err);
      setError('Failed to load library. Please check your connection.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  // One load on mount. (The old code also reloaded on every route change and fired 3 requests on mount;
  // this page remounts whenever you return from the viewer, so the mount load already covers that.)
  useEffect(() => {
    void loadLibrary();

    // Refresh quietly when the user comes back to the tab, at most once per interval.
    const refreshIfStale = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoadStartedRef.current < AUTO_REFRESH_MIN_INTERVAL_MS) return;
      void loadLibrary(true);
    };
    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    return () => {
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
    };
  }, [loadLibrary]);

  const formatDate = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    const day = date.getDate();
    const month = date.toLocaleString('en-US', { month: 'short' });
    const year = date.getFullYear();
    return year === new Date().getFullYear() ? `${day} ${month}` : `${day} ${month} ${year}`;
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => documents.filter((d) => !q || d.name.toLowerCase().includes(q)),
    [documents, q],
  );

  // numeric: true => "Volume-2" sorts before "Volume-10" even without zero-padding
  const byName = (a: PdfDocument, b: PdfDocument) => a.name.localeCompare(b.name, undefined, { numeric: true });
  // One section per R2 folder, discovered from the data – new folders show up with no code change.
  const sections = useMemo(() => {
    const byFolder = new Map<string, { title: string; docs: PdfDocument[] }>();
    for (const d of matches) {
      const section = byFolder.get(d.folder) ?? { title: d.folderTitle || d.folder, docs: [] };
      section.docs.push(d);
      byFolder.set(d.folder, section);
    }
    return [...byFolder.entries()]
      .map(([folder, { title, docs }]) => ({ folder, title, docs: docs.sort(byName) }))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  }, [matches]);

  // "Continue reading": most recently opened, in progress, not finished
  const continueReading = useMemo(
    () =>
      documents
        .filter((d) => d.lastOpened && d.lastPage > 1 && !isFinished(d))
        .sort((a, b) => Date.parse(b.lastOpened!) - Date.parse(a.lastOpened!))
        .slice(0, 3),
    [documents],
  );

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-gray-900 transition-colors">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-20 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <a 
                href={HOME_URL}
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors shrink-0"
                title="Go to main site"
                aria-label="Go to main site"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </a>
              <div className="h-5 w-px bg-gray-200 dark:bg-gray-700 shrink-0"></div>
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h1 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 truncate">My Library</h1>
                  <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 hidden sm:block">Writings & Speeches</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors"
                title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              >
                {theme === 'light' ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                )}
              </button>

              {/* Refresh */}
              <button
                onClick={() => loadLibrary()}
                disabled={loading}
                aria-label="Refresh library"
                className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors"
                title="Refresh"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>

              {/* Logout */}
              <a
                href={LOGOUT_URL}
                className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors"
                title="Logout"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="hidden sm:inline">Logout</span>
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Search */}
        {documents.length > 0 && (
          <div className="mb-6">
            <label htmlFor="library-search" className="sr-only">Search volumes</label>
            <input
              id="library-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search volumes…"
              className="w-full sm:max-w-sm px-3.5 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        {/* Continue reading */}
        {!q && continueReading.length > 0 && (
          <section className="mb-8" aria-label="Continue reading">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Continue reading</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {continueReading.map((doc) => (
                <DocCard key={`continue-${doc.id}`} doc={doc} formatDate={formatDate} formatSize={formatSize} />
              ))}
            </div>
          </section>
        )}

        {/* Loading State */}
        {loading && documents.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-indigo-200 dark:border-indigo-800 border-t-indigo-600 dark:border-t-indigo-400 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400 font-medium">Loading library from cloud...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="text-sm font-semibold text-red-900 dark:text-red-200 mb-1">Error Loading Library</h3>
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                <button
                  onClick={() => loadLibrary()}
                  className="mt-3 text-sm text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100 font-medium underline"
                >
                  Try Again
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && documents.length === 0 && !error && (
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-8 sm:p-12 text-center bg-white dark:bg-gray-800 transition-colors">
            <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-indigo-500 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-1">Your library is empty</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Create a folder in your R2 bucket and upload PDFs – it will appear here</p>
          </div>
        )}

        {documents.length > 0 && matches.length === 0 && (
          <p className="text-center text-gray-500 dark:text-gray-400 py-12">No volumes match “{query}”.</p>
        )}

        {/* Document Sections */}
        {documents.length > 0 && (
          <>
            {sections.map((section) => (
              <section key={section.folder} className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{section.title}</h2>
                  <span className="text-sm text-gray-500 dark:text-gray-400">({section.docs.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {section.docs.map((doc) => (
                    <DocCard key={doc.id} doc={doc} formatDate={formatDate} formatSize={formatSize} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}

// Document Card Component
function DocCard({ doc, formatDate, formatSize }: {
  doc: PdfDocument;
  formatDate: (iso: string) => string;
  formatSize: (bytes: number) => string;
}) {
  return (
    <Link
      to={`/viewer/${encodeURIComponent(doc.id)}`}
      className="group bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-lg transition-all overflow-hidden block"
    >
      <div className="p-4">
        {/* PDF Cover / Thumbnail */}
        <div className="w-full h-32 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 rounded-lg flex items-center justify-center mb-3 relative overflow-hidden">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-red-400 dark:text-red-500" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
            <path d="M14 2v6h6" opacity="0.3"/>
          </svg>
          <div className="absolute bottom-2 right-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
            PDF
          </div>
        </div>

        {/* Info */}
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate mb-1" title={doc.name}>
          {doc.name}
        </h3>
        
        {/* Progress - Always visible */}
        <div className="mt-2 mb-2">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {doc.totalPages === 0
                ? 'Not started'
                : isFinished(doc)
                  ? 'Finished ✓'
                  : `Page ${doc.lastPage} of ${doc.totalPages}`}
            </span>
            {doc.totalPages > 0 && (
              <span className="text-gray-500 dark:text-gray-400">
                {Math.min(100, Math.round((doc.lastPage / doc.totalPages) * 100))}%
              </span>
            )}
          </div>
          {doc.totalPages > 0 && (
            <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 dark:bg-indigo-400 rounded-full transition-all"
                style={{ width: `${Math.min(100, (doc.lastPage / doc.totalPages) * 100)}%` }}
              ></div>
            </div>
          )}
        </div>
        
        {/* Metadata */}
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>{formatSize(doc.size)}</span>
          <span>·</span>
          <span>{doc.lastOpened ? `Opened ${formatDate(doc.lastOpened)}` : 'Never opened'}</span>
        </div>
      </div>
    </Link>
  );
}
