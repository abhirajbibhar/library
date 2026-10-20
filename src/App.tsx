import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { registerLaunchQueue } from './lib/launchFiles';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Library from './pages/Library';
import BookDetail from './pages/BookDetail';
import Reader from './pages/Reader';
import Notes from './pages/Notes';
import Collections from './pages/Collections';
import CollectionDetail from './pages/CollectionDetail';
import DayStreak from './pages/DayStreak';
import DayDetail from './pages/DayDetail';
import Trash from './pages/Trash';
import Quotes from './pages/Quotes';
import Settings from './pages/Settings';
import { bookIdFor } from './lib/format';

/** Old links (#/viewer/<key>) keep working: they forward to the reader. */
function LegacyViewer() {
  const { id = '' } = useParams();
  return <Navigate to={`/reader/${bookIdFor(id)}${window.location.hash.includes('?') ? '?' + window.location.hash.split('?')[1] : ''}`} replace />;
}

/** PDFs opened with the installed app (Windows / macOS "Open with") land in the upload form. */
function LaunchHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    registerLaunchQueue(() => navigate(`/library?upload=${Date.now()}`));
  }, [navigate]);
  return null;
}

export default function App() {
  return (
    <HashRouter>
      <LaunchHandler />
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/library" element={<Library />} />
          <Route path="/book/:id" element={<BookDetail />} />
          <Route path="/reader/:id" element={<Reader />} />
          <Route path="/viewer/:id" element={<LegacyViewer />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/annotations" element={<Navigate to="/notes" replace />} />
          <Route path="/collections" element={<Collections />} />
          <Route path="/collections/:id" element={<CollectionDetail />} />
          <Route path="/streak" element={<DayStreak />} />
          <Route path="/streak/:date" element={<DayDetail />} />
          <Route path="/quotes" element={<Quotes />} />
          <Route path="/trash" element={<Trash />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}
