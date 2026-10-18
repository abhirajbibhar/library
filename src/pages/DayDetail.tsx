import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLibraryStore } from '../store';
import { Flame, Clock, BookOpen, Target, TrendingUp } from 'lucide-react';
import { localDay } from '../lib/format';
import type { Annotation, Book, ReadingLog } from '../types';

export default function DayDetail() {
  const { date } = useParams();
  const navigate = useNavigate();
  const { books, reading, annotations } = useLibraryStore();

  // Parse date from URL parameter
  const [year, month, day] = date!.split('-').map(Number);
  const selectedDate = new Date(year, month - 1, day);

  // Your real reading time for this day, taken from the reading log
  const readingData = buildDay(date!, books, reading, annotations);

  // Calculate some stats
  const totalMinutes = readingData.sessions.reduce((sum, s) => sum + s.minutesRead, 0);
  const booksRead = new Set(readingData.sessions.map(s => s.bookId)).size;

  const formattedDate = selectedDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white flex items-center gap-2 sm:gap-3">
          <Flame className="w-6 h-6 sm:w-8 sm:h-8 text-orange-400 flex-shrink-0" />
          <span className="truncate">{formattedDate}</span>
        </h1>
        <p className="text-gray-400 mt-2 text-sm sm:text-base">Your reading activity for this day</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          label="Time Spent"
          value={`${totalMinutes} min`}
          color="orange"
        />
        <StatCard
          icon={<BookOpen className="w-5 h-5" />}
          label="Notes Added"
          value={readingData.notes.length}
          color="blue"
        />
        <StatCard
          icon={<Target className="w-5 h-5" />}
          label="Books Read"
          value={booksRead}
          color="green"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Avg. per Book"
          value={`${booksRead > 0 ? Math.round(totalMinutes / booksRead) : 0} min`}
          color="purple"
        />
      </div>

      {/* Reading Sessions */}
      <div className="bg-gray-900 rounded-md border border-gray-800 p-6">
        <h2 className="text-xl font-semibold text-white mb-4">Reading Sessions</h2>
        {readingData.sessions.length === 0 ? (
          <div className="text-center py-12">
            <Flame className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">No reading sessions recorded</p>
            <p className="text-gray-600 text-sm mt-1">Start reading to track your progress</p>
          </div>
        ) : (
          <div className="space-y-3">
            {readingData.sessions.map((session, idx) => {
              const book = books.find(b => b.id === session.bookId);
              if (!book) return null;

              return (
                <Link
                  key={idx}
                  to={`/book/${book.id}`}
                  className="block p-4 bg-gray-800/50 rounded-md hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      <div className="w-12 h-12 rounded-md overflow-hidden bg-gray-800 flex items-center justify-center text-xl flex-shrink-0">
                        {book.cover ? <img src={book.cover} alt="" className="w-full h-full object-cover" /> : '📖'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-white truncate">
                          {book.title}
                        </h3>
                        <p className="text-xs text-gray-400 mt-0.5">{book.author || book.genre}</p>
                        <div className="flex items-center gap-4 mt-2">
                          <div className="flex items-center gap-1.5 text-xs text-gray-400">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{session.minutesRead} min</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-gray-400">
                            <BookOpen className="w-3.5 h-3.5" />
                            <span>{book.progress}% read</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-orange-400">
                        {session.minutesRead}
                      </p>
                      <p className="text-xs text-gray-500">min</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Notes Added */}
      {readingData.notes.length > 0 && (
        <div className="bg-gray-900 rounded-md border border-gray-800 p-6">
          <h2 className="text-xl font-semibold text-white mb-4">Notes & Highlights</h2>
          <div className="space-y-3">
            {readingData.notes.map((note, idx) => (
              <div key={idx} className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-md">
                <div className="flex items-start gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-400 mt-1.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-gray-300 line-clamp-3">{note.content}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {note.bookTitle} · Page {note.page}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Achievements */}
      {readingData.achievements.length > 0 && <div className="bg-gray-900 rounded-md border border-gray-800 p-6">
        <h2 className="text-xl font-semibold text-white mb-4">Achievements</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {readingData.achievements.map((achievement, idx) => (
            <div key={idx} className="flex items-center gap-3 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-md">
              <div className="w-10 h-10 rounded-md bg-yellow-500/20 flex items-center justify-center">
                <span className="text-xl">{achievement.icon}</span>
              </div>
              <div>
                <p className="text-sm font-medium text-white">{achievement.title}</p>
                <p className="text-xs text-gray-400">{achievement.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  const colorClasses: Record<string, string> = {
    orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  };

  return (
    <div className={`rounded-md border p-4 ${colorClasses[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-medium opacity-80">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

// Builds the day from your real data: time per book from the reading log, plus the notes you wrote that day
function buildDay(date: string, books: Book[], reading: ReadingLog | null, annotations: Annotation[]) {
  const seconds = reading?.dayDocs?.[date] ?? {};
  const byKey = new Map(books.map(b => [b.r2Key, b]));
  const sessions = Object.entries(seconds)
    .map(([key, secs]) => ({ bookId: byKey.get(key)?.id ?? '', minutesRead: Math.round(secs / 60), seconds: secs }))
    .filter(x => x.bookId && x.seconds >= 30)
    .sort((a, b) => b.seconds - a.seconds);

  const notes = annotations
    .filter(a => localDay(new Date(a.updatedAt)) === date)
    .map(a => ({ bookTitle: books.find(b => b.id === a.bookId)?.title ?? '', content: a.type === 'highlight' ? `“${a.content}”` : a.content, page: a.page }));

  const totalMinutes = sessions.reduce((n, s) => n + s.minutesRead, 0);
  const achievements: { icon: string; title: string; description: string }[] = [];
  if (totalMinutes >= 60) achievements.push({ icon: '⏰', title: 'Hour Power', description: 'Read for over an hour' });
  if (sessions.length >= 2) achievements.push({ icon: '🎯', title: 'Multi-Book Day', description: 'Read from more than one book' });
  if (sessions.some(s => s.minutesRead >= 45)) achievements.push({ icon: '🔥', title: 'Deep Focus', description: '45+ minutes with a single book' });
  if (notes.length >= 5) achievements.push({ icon: '✍️', title: 'Active Reader', description: 'Added five or more notes and highlights' });

  return { sessions, notes, achievements };
}
