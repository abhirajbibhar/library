import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../store';
import Dropdown from '../components/Dropdown';
import { Flame, Calendar, Award, Target } from 'lucide-react';
import { localDay, readingStreak } from '../lib/format';

const months = [
  { value: '0', label: 'January' },
  { value: '1', label: 'February' },
  { value: '2', label: 'March' },
  { value: '3', label: 'April' },
  { value: '4', label: 'May' },
  { value: '5', label: 'June' },
  { value: '6', label: 'July' },
  { value: '7', label: 'August' },
  { value: '8', label: 'September' },
  { value: '9', label: 'October' },
  { value: '10', label: 'November' },
  { value: '11', label: 'December' },
];

const thisYear = new Date().getFullYear();
const years = [thisYear - 2, thisYear - 1, thisYear].map(y => ({ value: String(y), label: String(y) }));

export default function DayStreak() {
  const { reading } = useLibraryStore();
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth().toString());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());

  // Real reading history: a day counts when you read for at least a minute
  const readingHistory = buildHistory(reading?.days ?? {}, reading?.dayDocs ?? {});
  const currentStreak = readingStreak(reading?.days ?? {});
  const longestStreak = calculateLongestStreak(readingHistory);
  const totalDaysRead = readingHistory.filter(day => day.read).length;

  const monthNum = parseInt(selectedMonth);
  const yearNum = parseInt(selectedYear);

  const daysInMonth = new Date(yearNum, monthNum + 1, 0).getDate();
  const firstDayOfMonth = new Date(yearNum, monthNum, 1).getDay();

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2 sm:gap-3">
          <Flame className="w-6 h-6 sm:w-8 sm:h-8 text-orange-400 flex-shrink-0" />
          <span className="truncate">Reading Streak</span>
        </h1>
        <p className="text-gray-400 mt-2 text-sm sm:text-base">Track your daily reading habits</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Flame className="w-5 h-5" />}
          label="Current Streak"
          value={`${currentStreak} days`}
          color="orange"
        />
        <StatCard
          icon={<Award className="w-5 h-5" />}
          label="Longest Streak"
          value={`${longestStreak} days`}
          color="yellow"
        />
        <StatCard
          icon={<Calendar className="w-5 h-5" />}
          label="Days Read"
          value={totalDaysRead}
          color="blue"
        />
        <StatCard
          icon={<Target className="w-5 h-5" />}
          label="This Month"
          value={`${readingHistory.filter(d => d.read && d.date.getMonth() === monthNum).length} days`}
          color="green"
        />
      </div>

        {/* Calendar */}
        <div className="bg-gray-900 rounded-md border border-gray-800 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-white">Reading Calendar</h2>
            <div className="flex items-center gap-2">
              <Dropdown
                options={months}
                value={selectedMonth}
                onChange={setSelectedMonth}
                className="w-full sm:w-auto sm:min-w-[120px]"
              />
              <Dropdown
                options={years}
                value={selectedYear}
                onChange={setSelectedYear}
                className="w-full sm:w-auto sm:min-w-[90px]"
              />
            </div>
          </div>
        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1">
          {/* Day headers */}
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
            <div key={idx} className="text-center text-[10px] font-medium text-gray-500 py-1">
              {day}
            </div>
          ))}

          {/* Empty cells for days before month starts */}
          {Array.from({ length: firstDayOfMonth }).map((_, idx) => (
            <div key={`empty-${idx}`} className="aspect-square" />
          ))}

          {/* Days */}
          {Array.from({ length: daysInMonth }).map((_, idx) => {
            const day = idx + 1;
            const date = new Date(yearNum, monthNum, day);
            const readingDay = readingHistory.find(d => 
              d.date.getDate() === day && 
              d.date.getMonth() === monthNum && 
              d.date.getFullYear() === yearNum
            );
            const hasRead = readingDay?.read || false;
            const isToday = date.toDateString() === new Date().toDateString();
            const dateStr = `${yearNum}-${String(monthNum + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            return (
              <button
                key={day}
                onClick={() => hasRead && navigate(`/streak/${dateStr}`)}
                disabled={!hasRead}
                className={`aspect-square rounded-sm flex flex-col items-center justify-center text-xs transition-all ${
                  hasRead
                    ? 'bg-orange-500/20 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30 cursor-pointer'
                    : 'bg-gray-800/50 border border-gray-800 text-gray-500 cursor-default'
                } ${isToday ? 'ring-2 ring-blue-500' : ''}`}
              >
                <span className="font-medium">{day}</span>
                {hasRead && <Flame className="w-2.5 h-2.5 mt-0.5" />}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-800">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-orange-500/20 border border-orange-500/30" />
            <span className="text-[10px] text-gray-400">Read</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-gray-800/50 border border-gray-800" />
            <span className="text-[10px] text-gray-400">No activity</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm ring-2 ring-blue-500" />
            <span className="text-[10px] text-gray-400">Today</span>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-gray-900 rounded-md border border-gray-800 p-4">
        <h2 className="text-lg font-semibold text-white mb-3">Recent Activity</h2>
        <div className="space-y-2">
          {readingHistory.filter(day => day.read).length === 0 && (
            <p className="text-sm text-gray-500 py-2">Your reading time will show up here once you have read for a minute or more.</p>
          )}
          {readingHistory
            .filter(day => day.read)
            .slice(0, 7)
            .map((day, idx) => {
              const dateStr = `${day.date.getFullYear()}-${String(day.date.getMonth() + 1).padStart(2, '0')}-${String(day.date.getDate()).padStart(2, '0')}`;
              return (
                <button
                  key={idx}
                  onClick={() => navigate(`/streak/${dateStr}`)}
                  className="w-full flex items-center justify-between p-2.5 bg-gray-800/50 rounded-md hover:bg-gray-800 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-md bg-orange-500/20 flex items-center justify-center">
                      <Flame className="w-4 h-4 text-orange-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">
                        {day.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </p>
                      <p className="text-xs text-gray-400">{day.books} {day.books === 1 ? 'book' : 'books'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-orange-400">{day.minutesRead} min</p>
                  </div>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  const colorClasses: Record<string, string> = {
    orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
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

// Helper functions
interface HistoryDay { date: Date; read: boolean; minutesRead: number; books: number }

/** Newest first, covering the last ~13 months of the reading log. */
function buildHistory(days: Record<string, number>, dayDocs: Record<string, Record<string, number>>): HistoryDay[] {
  const out: HistoryDay[] = [];
  const d = new Date();
  for (let i = 0; i < 400; i++) {
    const key = localDay(d);
    const seconds = days[key] ?? 0;
    out.push({ date: new Date(d), read: seconds >= 60, minutesRead: Math.round(seconds / 60), books: Object.keys(dayDocs[key] ?? {}).length });
    d.setDate(d.getDate() - 1);
  }
  return out;
}

function calculateLongestStreak(history: HistoryDay[]) {
  let longest = 0;
  let current = 0;
  for (const day of [...history].reverse()) {
    if (day.read) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}
