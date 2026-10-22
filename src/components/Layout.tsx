import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLibraryStore, refreshIfStale } from '../store';
import { readerBridge, useReaderBridge } from '../lib/readerBridge';
import { LOGOUT_URL } from '../config';
import { clearOfflineData } from '../lib/offline';
import { hasMod } from '../lib/platform';
import { 
  LayoutDashboard, Library, StickyNote, FolderOpen, 
  Settings, Menu, X, Cloud, ArrowLeft, Flame, Trash2, Quote, RefreshCw, LogOut, NotebookPen
} from 'lucide-react';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/library', label: 'Library', icon: Library },
  { path: '/notes', label: 'Notes & Highlights', icon: StickyNote },
  { path: '/notebook', label: 'Notebook', icon: NotebookPen },
  { path: '/collections', label: 'Collections', icon: FolderOpen },
  { path: '/quotes', label: 'Quotes', icon: Quote },
  { path: '/streak', label: 'Day Streak', icon: Flame },
  { path: '/trash', label: 'Trash', icon: Trash2 },
  { path: '/settings', label: 'Settings', icon: Settings },
];

// Pages that should show a back button
const subPages = ['/book/', '/reader/', '/collections/', '/streak/'];
const FULL_BLEED = ['/reader/']; // the reader brings its own padding and toolbar

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const navigate = useNavigate();

  // Ctrl+K (Windows, Linux) or ⌘K (macOS) jumps to search from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hasMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate(`/library?search=${Date.now()}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const { loaded, loading, error, refresh, notice, getBook } = useLibraryStore();
  const bridge = useReaderBridge();

  // Load everything from the Worker once, then refresh quietly whenever the tab comes back.
  useEffect(() => {
    void refresh();
    const onVisible = () => document.visibilityState === 'visible' && refreshIfStale();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  // Reset scroll position on route change
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
  }, [location.pathname]);

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Set initial state
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Check if we're on a sub-page that needs a back button
  const isSubPage = subPages.some(prefix => location.pathname.startsWith(prefix));
  
  // Determine back path based on current route
  const getBackPath = () => {
    if (location.pathname.startsWith('/reader/')) {
      return `/book/${location.pathname.split('/')[2]}`;
    }
    if (location.pathname.startsWith('/collections/') && location.pathname !== '/collections/') {
      return '/collections';
    }
    if (location.pathname.startsWith('/streak/') && location.pathname !== '/streak/') {
      return '/streak';
    }
    return '/library';
  };
  
  const backPath = getBackPath();
  const readerBook = location.pathname.startsWith('/reader/') ? getBook(location.pathname.split('/')[2] ?? '') : undefined;
  const fullBleed = FULL_BLEED.some((p) => location.pathname.startsWith(p));

  return (
    <div className="h-screen bg-gray-950 text-gray-100 flex flex-col overflow-hidden">
      {/* ── Full-width Header ── */}
      <header className="h-16 flex-shrink-0 bg-gray-900 border-b border-gray-800 flex items-center z-30 relative">
        {/* Brand section – same width as sidebar so it aligns, hidden on mobile */}
        <div className="w-64 flex-shrink-0 px-5 flex items-center gap-3 border-r border-gray-800 h-full hidden lg:flex">
          <Link to="/" className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-md bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <Cloud className="w-4.5 h-4.5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-white truncate">My Library</h1>
              <p lang="or" className="text-[11px] text-gray-500 leading-none mt-0.5 truncate" style={{ fontFamily: "'Noto Sans Oriya', 'Noto Sans', system-ui, sans-serif" }}>ଅଜ୍ଝତ୍ତଂ ଏବ ମଗ୍ଗୋ’ତି</p>
            </div>
          </Link>
        </div>

        {/* Right side of header */}
        <div className="flex-1 flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-2 min-w-0">
            {isSubPage ? (
              /* On a page you can go back from, the back arrow takes the place of the menu button */
              <Link
                to={backPath}
                aria-label="Back"
                title="Back"
                className="p-2 rounded-md hover:bg-gray-800 text-gray-400 hover:text-white transition-colors flex-shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
            ) : (
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
                className="lg:hidden p-2 rounded-md hover:bg-gray-800 text-gray-400"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}
            {readerBook && (
              <h2 className="text-sm font-medium text-white truncate" title={readerBook.title}>{readerBook.title}</h2>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {bridge.active && (
              <button
                onClick={() => readerBridge.refresh?.()}
                disabled={bridge.busy}
                aria-label="Refresh: pull the latest annotations and progress"
                title="Refresh: pull the latest annotations and progress from your other devices"
                className="relative p-2 rounded-md hover:bg-gray-800 text-gray-300 disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${bridge.busy ? 'animate-spin' : ''}`} />
                {bridge.dirty && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400" title="Unsaved changes" />}
              </button>
            )}
            <div 
              className={`w-2 h-2 rounded-full ${
                isOnline 
                  ? 'bg-green-400 animate-pulse' 
                  : 'bg-gray-600'
              }`} 
              title={isOnline ? 'Online' : 'Offline'}
            />
            <a
              href={LOGOUT_URL}
              onClick={(e) => {
                // Leave nothing behind on this device: saved books and cached lists are removed before signing out
                e.preventDefault();
                void clearOfflineData().finally(() => { window.location.href = LOGOUT_URL; });
              }}
              aria-label="Log out"
              title="Log out"
              className="p-2 rounded-md hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </a>
          </div>
        </div>
      </header>

      {/* ── Body: Sidebar + Content ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile overlay – only covers content area, not header */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 bg-black/60 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar – independent scroll */}
        <aside
          className={`
            w-64 flex-shrink-0 bg-gray-900 border-r border-gray-800
            flex flex-col overflow-hidden
            absolute lg:relative inset-y-0 left-0 z-50
            transform transition-transform duration-200 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}
        >
          {/* Navigation – scrolls independently */}
          <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path ||
                (item.path !== '/' && location.pathname.startsWith(item.path));
              const Icon = item.icon;

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  className={`
                    flex items-center gap-3 px-3.5 py-2.5 rounded-md text-sm font-medium
                    transition-all duration-150
                    ${isActive
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }
                  `}
                >
                  <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>

        </aside>

        {/* Main Content – independent scroll */}
        <main ref={mainRef} className={`flex-1 overflow-y-auto ${fullBleed ? 'p-0' : 'p-4 lg:p-8'}`}>
          {!isOnline && (
            <div role="status" className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-center text-sm text-amber-200">
              You’re offline. Books saved for offline reading still open; changes sync when you’re back online.
            </div>
          )}
          {!loaded ? (
            <div className="h-full flex items-center justify-center">
              {error ? (
                <div className="text-center max-w-sm">
                  <p className="text-white font-semibold">Couldn’t load your library</p>
                  <p className="text-gray-400 text-sm mt-1">{error}</p>
                  <button onClick={() => void refresh()} className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium">Try again</button>
                </div>
              ) : (
                <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" role="status" aria-label={loading ? 'Loading' : 'Starting'} />
              )}
            </div>
          ) : (
            children
          )}
        </main>
        {notice && (
          <div role="status" className="absolute inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
            <div className="rounded-md bg-gray-100 px-4 py-3 text-sm font-medium text-gray-900 shadow-xl">{notice}</div>
          </div>
        )}
      </div>
    </div>
  );
}
