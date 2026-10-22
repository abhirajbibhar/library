import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLibraryStore } from '../store';
import { useBookActions } from '../hooks/useBookActions';
import { useFetch } from '../hooks/useFetch';
import { loadNote, parseNote, summarize, today } from '../lib/notes';
import { coverColor, formatDuration, localDay, plural } from '../lib/format';
import BookGrid from '../components/BookGrid';
import type { Book } from '../types';
import type { MenuEntry } from '../components/Menu';
import QuoteSection from '../components/QuoteSection';
import { 
  BookOpen, BookPlus, TrendingUp, StickyNote,
  Flame, Clock, ArrowRight, Sparkles, Folder, Star, Upload, NotebookPen
} from 'lucide-react';

/** The morning view: today's to-dos from the notebook, or a nudge to plan the day. */
function TodayPlan() {
  const { data } = useFetch(() => loadNote(today()));
  const tasks = parseNote(data?.text ?? '').tasks;
  const { total, done, percent } = summarize(tasks);
  const open = tasks.filter(t => t.percent < 100).slice(0, 4);

  return (
    <section className="bg-gray-900 rounded-md border border-gray-800 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2"><NotebookPen className="w-5 h-5 text-blue-400" />Today’s plan</h2>
        <Link to="/notebook" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1">Open notebook <ArrowRight className="w-4 h-4" /></Link>
      </div>
      {total === 0 ? (
        <p className="text-sm text-gray-400 mt-3">Nothing planned yet. <Link to="/notebook" className="text-blue-400 hover:text-blue-300 underline">Write today’s to-dos</Link> and start your day.</p>
      ) : (
        <>
          <div className="flex items-center gap-3 mt-4">
            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-blue-500 transition-all" style={{ width: `${percent}%` }} /></div>
            <span className="text-sm text-gray-300 shrink-0">{done} of {total} done</span>
          </div>
          {open.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {open.map((t, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-gray-200">
                  <span aria-hidden="true" className={`w-3.5 h-3.5 rounded border shrink-0 ${t.percent > 0 ? 'border-amber-500' : 'border-gray-600'}`} />
                  <span className="truncate">{t.text}</span>
                  {t.percent > 0 && <span className="text-xs text-amber-300 shrink-0">{t.percent}%</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-green-300 mt-3">Everything on today’s list is done.</p>
          )}
        </>
      )}
    </section>
  );
}

/** A titled row of books with a "View all" link; renders nothing when empty. */
function Shelf({ icon, title, books, menuFor }: { icon: ReactNode; title: string; books: Book[]; menuFor: (b: Book) => MenuEntry[] }) {
  if (books.length === 0) return null;
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">{icon}{title}</h2>
        <Link to="/library" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1">
          View all <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      <BookGrid books={books} menuFor={menuFor} />
    </section>
  );
}

export default function Dashboard() {
  const { books, folders, reading, getStats } = useLibraryStore();
  const { menuFor, dialog } = useBookActions();

  const stats = getStats();
  const continueReading = books
    .filter(b => b.progress > 0 && b.progress < 100 && b.lastReadAt)
    .sort((a, b) => (b.lastReadAt || '').localeCompare(a.lastReadAt || ''))
    .slice(0, 4);
  const favourites = books.filter(b => b.favorite).slice(0, 4);
  const recentlyAdded = [...books]
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
    .slice(0, 4);

  // Last 7 days of real reading time, oldest first
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), seconds: reading?.days[localDay(d)] ?? 0 };
  });
  const weekMax = Math.max(60, reading?.goalMinutes ? reading.goalMinutes * 60 : 0, ...week.map(d => d.seconds));
  const goal = reading?.goalMinutes ?? 0;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2 sm:gap-3">
          <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 text-blue-400 flex-shrink-0" />
          <span className="truncate">Welcome back</span>
        </h1>
        <p className="text-gray-400 mt-2 text-sm sm:text-base">Here's your library overview</p>
      </div>

      {/* Quote Section */}
      <QuoteSection />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          icon={<BookOpen className="w-5 h-5" />}
          label="Total Books" 
          value={stats.totalBooks} 
          color="blue" 
        />
        <StatCard 
          icon={<TrendingUp className="w-5 h-5" />}
          label="Pages Read" 
          value={stats.totalPages.toLocaleString()} 
          color="green" 
        />
        <StatCard 
          icon={<StickyNote className="w-5 h-5" />}
          label="Notes" 
          value={stats.totalNotes} 
          color="purple" 
        />
        <Link to="/streak">
          <StatCard 
            icon={<Flame className="w-5 h-5" />}
            label="Day Streak" 
            value={stats.streak} 
            color="orange" 
          />
        </Link>
      </div>

      {/* Today's plan — right before Continue Reading */}
      <TodayPlan />

      <Shelf icon={<Clock className="w-5 h-5 text-blue-400" />} title="Continue Reading" books={continueReading} menuFor={menuFor} />
      <Shelf icon={<Star className="w-5 h-5 text-amber-400" />} title="Favourites" books={favourites} menuFor={menuFor} />

      {/* Empty library */}
      {books.length === 0 && (
        <div className="text-center py-16 bg-gray-900 rounded-md border border-gray-800">
          <p className="text-white text-lg font-semibold">Your library is empty</p>
          <p className="text-gray-400 text-sm mt-1">Upload a PDF to start. Each folder becomes a group in your library.</p>
          <Link to="/library?upload=1" className="inline-flex items-center gap-2 mt-5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors">
            <Upload className="w-4 h-4" /> Add your first book
          </Link>
        </div>
      )}

      <Shelf icon={<BookPlus className="w-5 h-5 text-purple-400" />} title="Recently Added" books={recentlyAdded} menuFor={menuFor} />

      {/* Quick Stats */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Reading Activity */}
        <div className="bg-gray-900 rounded-md border border-gray-800 p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Weekly Activity</h3>
          <div className="space-y-4">
            <div role="img" aria-label={`Reading time per day: ${week.map(d => `${d.label} ${formatDuration(d.seconds)}`).join(', ')}`}>
              <div className="flex items-end justify-between gap-1 h-32">
                {week.map((d, idx) => (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full bg-gray-800 rounded-sm relative overflow-hidden" style={{ height: '100px' }}>
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-blue-500 to-blue-400 rounded-sm transition-all duration-500"
                        style={{ height: `${d.seconds >= 60 ? Math.max(6, (d.seconds / weekMax) * 100) : 0}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">{d.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-gray-800">
              <div>
                <p className="text-2xl font-bold text-white">{formatDuration(stats.thisWeekSeconds)}</p>
                <p className="text-xs text-gray-400">Read this week</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{stats.booksRead}</p>
                <p className="text-xs text-gray-400">Books completed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{stats.streak}</p>
                <p className="text-xs text-gray-400">Day streak</p>
              </div>
            </div>
            {goal > 0 && (
              <p className="text-xs text-gray-400">Today: {formatDuration(week[6].seconds)} of your {goal} minute goal</p>
            )}
          </div>
        </div>

        {/* Collections Overview */}
        <div className="bg-gray-900 rounded-md border border-gray-800 p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Your Collections</h3>
          <div className="space-y-3">
            {folders.length === 0 && <p className="text-sm text-gray-500">No collections yet. Add a book to a new folder and it appears here.</p>}
            {folders.slice(0, 6).map(f => (
              <Link
                key={f.name}
                to={`/collections/${encodeURIComponent(f.name)}`}
                className="flex items-center justify-between p-3 rounded-md bg-gray-800/50 hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded flex items-center justify-center shrink-0" style={{ backgroundColor: `${coverColor(f.name)}33` }}>
                    <Folder className="w-4 h-4" style={{ color: coverColor(f.name) }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{f.name}</p>
                    <p className="text-xs text-gray-400">{plural(f.count, 'book')}</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-500 shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      </section>
      {dialog}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: ReactNode; label: string; value: number | string; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  };

  return (
    <div className={`rounded-md border p-4 transition-all hover:scale-[1.02] hover:shadow-lg ${colorClasses[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-medium opacity-80">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}


