import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Target, HardDrive, Folder, Download, Image as ImageIcon, Trash2, Smartphone, LogOut } from 'lucide-react';
import { useLibraryStore } from '../store';
import { useBookActions } from '../hooks/useBookActions';
import { generateCoverFor } from '../lib/cover';
import { annotationsToCsv, annotationsToMarkdown, downloadText } from '../lib/export';
import { formatSize, plural } from '../lib/format';
import { LOGOUT_URL } from '../config';
import Dropdown from '../components/Dropdown';
import Menu from '../components/Menu';

const GOALS = [
  { value: '0', label: 'No daily goal' },
  { value: '10', label: '10 minutes a day' },
  { value: '20', label: '20 minutes a day' },
  { value: '30', label: '30 minutes a day' },
  { value: '60', label: '1 hour a day' },
];

// Chrome and Edge fire this when the app can be installed
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

export default function Settings() {
  const { books, docs, annotations, reading, storage, setDailyGoal, refresh, showNotice } = useLibraryStore();
  const { menuForFolder, dialog } = useBookActions();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [coverProgress, setCoverProgress] = useState<string | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const folders = [...new Set(docs.map((d) => d.folder))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const sizeOf = (folder: string) => storage?.folders.find((f) => f.name === folder)?.size;
  const missing = books.filter((b) => !b.cover);

  const drawCovers = async () => {
    if (missing.length === 0) return showNotice('Every book already has a cover');
    let drawn = 0;
    for (let i = 0; i < missing.length; i++) {
      setCoverProgress(`Drawing covers… ${i + 1} of ${missing.length}`);
      try {
        await generateCoverFor({ id: missing[i].r2Key });
        drawn += 1;
      } catch (err) {
        console.warn('Cover failed for', missing[i].r2Key, err);
      }
    }
    setCoverProgress(null);
    showNotice(drawn ? `Drew ${plural(drawn, 'cover')}` : 'Couldn’t draw covers. Check your connection.');
    await refresh(true);
  };

  const allAnnotations = annotations.map((a) => {
    const b = books.find((x) => x.id === a.bookId);
    return { docId: a.r2Key, folder: b?.folder ?? '', docName: b?.title ?? '', id: a.annotationId, page: a.page, type: a.type, text: a.type === 'highlight' ? a.content : '', note: a.type === 'highlight' ? a.comment : a.content, color: a.color ?? null, created: a.createdAt, modified: a.updatedAt };
  });

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Settings</h1>
        <p className="text-gray-400 mt-1 text-sm sm:text-base">Goals, folders, storage and your data</p>
      </div>

      {/* Reading goal */}
      <Section icon={<Target className="w-5 h-5 text-orange-400" />} tint="bg-orange-500/10" title="Daily reading goal" subtitle="Shown on your dashboard next to today’s reading time">
        <Dropdown options={GOALS} value={String(reading?.goalMinutes ?? 0)} onChange={(v) => void setDailyGoal(Number(v))} className="sm:max-w-xs" />
      </Section>

      {/* Folders */}
      <Section icon={<Folder className="w-5 h-5 text-blue-400" />} tint="bg-blue-500/10" title="Folders" subtitle="Each folder in your bucket is a group in the library">
        {folders.length === 0 ? (
          <p className="text-sm text-gray-500">No folders yet. Add a book and choose “Create new folder”.</p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {folders.map((f) => (
              <li key={f} className="flex items-center gap-3 py-2.5">
                <Folder className="w-4 h-4 text-gray-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{f}</p>
                  <p className="text-xs text-gray-500">{plural(books.filter((b) => b.folder === f).length, 'book')}{sizeOf(f) !== undefined ? ` · ${formatSize(sizeOf(f)!)}` : ''}</p>
                </div>
                <Menu label={`Options for ${f}`} entries={menuForFolder(f)} />
              </li>
            ))}
          </ul>
        )}
        <Link to="/library?upload=1" className="inline-block mt-3 text-sm text-blue-400 hover:text-blue-300">Add books to a new folder</Link>
      </Section>

      {/* Storage */}
      <Section icon={<HardDrive className="w-5 h-5 text-green-400" />} tint="bg-green-500/10" title="Storage" subtitle="What your library uses in Cloudflare R2">
        {storage ? (
          <>
            <p className="text-3xl font-bold text-white">{formatSize(storage.total)} <span className="text-sm font-normal text-gray-400">used</span></p>
            <ul className="mt-3 divide-y divide-gray-800 text-sm">
              {storage.folders.map((f) => <Row key={f.name} label={f.name} value={formatSize(f.size)} />)}
              <Row label="Covers and settings" value={formatSize(storage.other)} />
              <Row label="Highlights and notes" value={formatSize(storage.annotations)} />
              <Row label="Earlier versions" value={formatSize(storage.backups)} />
              <Row label="Trash" value={formatSize(storage.trash)} />
            </ul>
          </>
        ) : (
          <p className="text-sm text-gray-500">Storage usage isn’t available right now.</p>
        )}
      </Section>

      {/* Data */}
      <Section icon={<Download className="w-5 h-5 text-purple-400" />} tint="bg-purple-500/10" title="Your data" subtitle="Covers, exports and the trash">
        <div className="space-y-3">
          <ActionRow icon={<ImageIcon className="w-4 h-4" />} title="Draw missing covers" hint={coverProgress ?? (missing.length ? `${plural(missing.length, 'book')} without a cover` : 'Every book has a cover')} onClick={() => void drawCovers()} disabled={!!coverProgress || missing.length === 0} label="Draw" />
          <ActionRow icon={<Download className="w-4 h-4" />} title="Export all notes and highlights" hint={`${plural(allAnnotations.length, 'annotation')}`} onClick={() => downloadText('annotations.md', annotationsToMarkdown(allAnnotations, 'All annotations'), 'text/markdown')} disabled={allAnnotations.length === 0} label="Markdown" />
          <ActionRow icon={<Download className="w-4 h-4" />} title="Export as a spreadsheet" hint="Opens in Excel, Numbers and Google Sheets" onClick={() => downloadText('annotations.csv', annotationsToCsv(allAnnotations), 'text/csv')} disabled={allAnnotations.length === 0} label="CSV" />
          <Link to="/trash" className="flex items-center gap-3 p-3 rounded-md bg-gray-800/50 hover:bg-gray-800 transition-colors">
            <Trash2 className="w-4 h-4 text-gray-400" />
            <div className="flex-1"><p className="text-sm text-white">Trash</p><p className="text-xs text-gray-500">Restore deleted books within 30 days</p></div>
          </Link>
        </div>
      </Section>

      {/* App */}
      <Section icon={<Smartphone className="w-5 h-5 text-cyan-400" />} tint="bg-cyan-500/10" title="App" subtitle="Install it for a full-screen icon on your home screen">
        {install ? (
          <button onClick={() => void install.prompt().then(() => setInstall(null))} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors">Install app</button>
        ) : (
          <p className="text-sm text-gray-400">Use your browser’s menu: “Install app” or “Add to Home Screen”.</p>
        )}
        <a href={LOGOUT_URL} className="inline-flex items-center gap-2 mt-4 text-sm text-gray-400 hover:text-white"><LogOut className="w-4 h-4" />Log out</a>
      </Section>
      {dialog}
    </div>
  );
}

function Section({ icon, tint, title, subtitle, children }: { icon: React.ReactNode; tint: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="bg-gray-900 rounded-md border border-gray-800 overflow-hidden">
      <div className="p-6 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-md ${tint} flex items-center justify-center`}>{icon}</div>
          <div><h2 className="text-lg font-semibold text-white">{title}</h2><p className="text-xs text-gray-400">{subtitle}</p></div>
        </div>
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <li className="flex items-center justify-between py-2"><span className="text-gray-300 truncate pr-3">{label}</span><span className="text-gray-400 shrink-0">{value}</span></li>;
}

function ActionRow({ icon, title, hint, onClick, disabled, label }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-md bg-gray-800/50">
      <span className="text-gray-400">{icon}</span>
      <div className="min-w-0 flex-1"><p className="text-sm text-white">{title}</p><p className="text-xs text-gray-500 truncate">{hint}</p></div>
      <button onClick={onClick} disabled={disabled} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white rounded-md text-xs font-medium transition-colors">{label}</button>
    </div>
  );
}
