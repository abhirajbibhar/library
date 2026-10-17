import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import HomePage from './pages/HomePage';
import LibraryPage from './pages/LibraryPage';
import FolderPage from './pages/FolderPage';
import AnnotationsPage from './pages/AnnotationsPage';
import UploadPage from './pages/UploadPage';

// The viewer pulls in ~1.3 MB of JS + a 4.6 MB PDFium wasm; don't make the library page pay for it.
const ViewerPage = lazy(() => import('./pages/ViewerPage'));

function PageSpinner() {
  return (
    <div className="h-dvh flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="w-12 h-12 border-4 border-indigo-200 dark:border-indigo-800 border-t-indigo-600 dark:border-t-indigo-400 rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/folder/:name" element={<FolderPage />} />
            <Route path="/annotations" element={<AnnotationsPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/viewer/:id" element={<ViewerPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </ThemeProvider>
  );
}
