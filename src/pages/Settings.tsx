import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Target, HardDrive, Folder, Download, Image as ImageIcon, Trash2, Smartphone, LogOut, ChevronRight, ShieldCheck, ShieldAlert, CloudOff } from 'lucide-react';
import { useLibraryStore } from '../store';
import { useBookActions } from '../hooks/useBookActions';
import { generateCoverFor } from '../lib/cover';
import { annotationsToCsv, annotationsToMarkdown, downloadText } from '../lib/export';
import { formatSize, plural } from '../lib/format';
import { API_BASE, LOGOUT_URL } from '../config';
import { useFetch } from '../hooks/useFetch';
import { clearOfflineData, getAutoCount, removeOffline, setAutoCount, useOffline } from '../lib/offline';
import { modKey } from '../lib/platform';
import Dropdown from '../components/Dropdown';
import Menu from '../components/Menu';

const AUTO_OPTIONS = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'The last book I read' },
  { value: '3', label: 'The last 3 books' },
  { value: '5', label: 'The last 5 books' },
  { value: '10', label: 'The last 10 books' },
];

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
  const [auto, setAuto] = useState(getAutoCount());
  const offline = useOffline();
  const session = useFetch<{ secured: boolean; email: string | null }>(async () => {
    const res = await fetch(`${API_BASE}/session`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return res.json();
  });

  const signOut = (e: React.MouseEvent) => {
    // Remove saved books and cached lists from this device before signing out
    e.preventDefault();
    void clearOfflineData().finally(() => { window.location.href = LOGOUT_URL; });
  };

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
      <Section icon={<Folder className="w-5 h-5 text-blue-400" />} tint="bg-blue-500/10" title="Folders">
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
              <Row label="Covers, notebook and settings" value={formatSize(storage.other)} />
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
          <ActionRow icon={<ImageIcon className="w-4 h-4" />} title="Draw missing covers" hint={coverProgress ?? (missing.length ? `${plural(missing.length, 'book')} without a cover · each is downloaded once` : 'Every book has a cover')} onClick={() => void drawCovers()} disabled={!!coverProgress || missing.length === 0} label="Draw" />
          <ActionRow icon={<Download className="w-4 h-4" />} title="Export all notes and highlights" hint={`${plural(allAnnotations.length, 'annotation')}`} onClick={() => downloadText('annotations.md', annotationsToMarkdown(allAnnotations, 'All annotations'), 'text/markdown')} disabled={allAnnotations.length === 0} label="Markdown" />
          <ActionRow icon={<Download className="w-4 h-4" />} title="Export as a spreadsheet" hint="Opens in Excel, Numbers and Google Sheets" onClick={() => downloadText('annotations.csv', annotationsToCsv(allAnnotations), 'text/csv')} disabled={allAnnotations.length === 0} label="CSV" />
          <Link to="/trash" className="flex items-center gap-3 p-3 rounded-md bg-gray-800/50 hover:bg-gray-800 transition-colors">
            <Trash2 className="w-4 h-4 text-gray-400" />
            <div className="flex-1"><p className="text-sm text-white">Trash</p><p className="text-xs text-gray-500">Restore deleted books within 30 days</p></div>
          </Link>
        </div>
      </Section>

      {/* Offline reading */}
      <Section icon={<CloudOff className="w-5 h-5 text-teal-400" />} tint="bg-teal-500/10" title="Offline reading" subtitle="Books saved on this device open without a connection">
        <label className="text-xs text-gray-400 block mb-1.5">Keep recently read books offline</label>
        <Dropdown options={AUTO_OPTIONS} value={String(auto)} onChange={(v) => { setAuto(Number(v)); setAutoCount(Number(v)); }} className="sm:max-w-xs" />
        {auto > 0 && <p className="text-xs text-gray-500 mt-2">Each book downloads in full the first time you open it, so this uses data. It is skipped on slow or data-saver connections.</p>}

        <div className="mt-5">
          <p className="text-sm text-white">{offline.entries.length ? `${plural(offline.entries.length, 'book')} saved · ${formatSize(offline.bytes)}` : 'No books saved on this device yet'}</p>
          {offline.entries.length > 0 && (
            <ul className="mt-2 divide-y divide-gray-800">
              {offline.entries.map(([key, e]) => (
                <li key={key} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{books.find((b) => b.r2Key === key)?.title ?? key.split('/').pop()}</p>
                    <p className="text-xs text-gray-500">{formatSize(e.size)} · {e.pinned ? 'saved by you' : 'kept automatically'}</p>
                  </div>
                  <button onClick={() => void removeOffline(key)} aria-label="Remove offline copy" title="Remove offline copy" className="p-2 rounded-md hover:bg-red-500/10 text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500 mt-3">Choose “Save for offline” in any book’s ⋯ menu to keep it for good. Your notes and progress are saved here too and sync when you’re back online.</p>
          <button onClick={() => { if (window.confirm('Remove all saved books and cached lists from this device?')) void clearOfflineData(); }} className="mt-3 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-md text-xs font-medium transition-colors">Clear offline data</button>
        </div>
      </Section>

      {/* Security */}
      <Section icon={session.data?.secured ? <ShieldCheck className="w-5 h-5 text-green-400" /> : <ShieldAlert className="w-5 h-5 text-amber-400" />} tint={session.data?.secured ? 'bg-green-500/10' : 'bg-amber-500/10'} title="Security">
        {session.loading && !session.data ? (
          <p className="text-sm text-gray-500">Checking…</p>
        ) : session.error || !session.data ? (
          <p className="text-sm text-gray-400">Couldn’t check the sign-in status.</p>
        ) : session.data.secured ? (
          <p className="text-sm text-gray-300">Every request is checked against Cloudflare Access{session.data.email ? <>. Signed in as <span className="text-white">{session.data.email}</span></> : ''}.</p>
        ) : (
          <div className="text-sm text-gray-300 space-y-2">
            <p className="text-amber-300 font-medium">The API isn’t checking sign-in yet.</p>
            <p className="text-gray-400">If Cloudflare Access were ever turned off for this site, anyone with the address could read and delete your library. To lock it in the Worker too, add two secrets in the Cloudflare dashboard (your Worker → Settings → Variables and Secrets):</p>
            <ul className="text-xs text-gray-400 list-disc pl-5 space-y-1"><li><code className="text-gray-300">ACCESS_TEAM_DOMAIN</code>: your team domain, like <code className="text-gray-300">myteam.cloudflareaccess.com</code></li><li><code className="text-gray-300">ACCESS_AUD</code>: the Access application’s “Application Audience (AUD) Tag”</li></ul>
          </div>
        )}
      </Section>

      {/* Shortcuts */}
      <Section icon={<Smartphone className="w-5 h-5 text-gray-300" />} tint="bg-gray-700/40" title="Keyboard shortcuts">
        <ul className="text-sm divide-y divide-gray-800">
          <li className="flex justify-between py-2"><span className="text-gray-300">Search the library</span><kbd className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-200">{modKey} + K</kbd></li>
          <li className="flex justify-between py-2"><span className="text-gray-300">Save annotations now (reader)</span><kbd className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-200">{modKey} + S</kbd></li>
        </ul>
      </Section>

      {/* App and account */}
      <section className="bg-gray-900 rounded-md border border-gray-800 divide-y divide-gray-800">
        {install ? (
          <button onClick={() => void install.prompt().then(() => setInstall(null))} className="w-full flex items-center gap-4 p-4 sm:p-5 text-left hover:bg-gray-800/60 transition-colors rounded-t-md">
            <span className="w-10 h-10 rounded-md bg-cyan-500/10 flex items-center justify-center shrink-0"><Smartphone className="w-5 h-5 text-cyan-400" /></span>
            <span className="flex-1 min-w-0"><span className="block text-sm font-medium text-white">Install app</span><span className="block text-xs text-gray-400">Add it to your home screen for a full-screen start</span></span>
            <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
          </button>
        ) : (
          <div className="flex items-center gap-4 p-4 sm:p-5">
            <span className="w-10 h-10 rounded-md bg-cyan-500/10 flex items-center justify-center shrink-0"><Smartphone className="w-5 h-5 text-cyan-400" /></span>
            <span className="flex-1 min-w-0"><span className="block text-sm font-medium text-white">Install app</span><span className="block text-xs text-gray-400">Chrome or Edge on Windows and macOS: the install icon in the address bar. Safari on Mac: File → Add to Dock. Phones: Add to Home Screen</span></span>
          </div>
        )}
        <a href={LOGOUT_URL} onClick={signOut} className="flex items-center gap-4 p-4 sm:p-5 hover:bg-red-500/5 transition-colors rounded-b-md">
          <span className="w-10 h-10 rounded-md bg-red-500/10 flex items-center justify-center shrink-0"><LogOut className="w-5 h-5 text-red-400" /></span>
          <span className="flex-1 text-sm font-medium text-red-300">Log out</span>
          <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
        </a>
      </section>
      {dialog}
    </div>
  );
}

function Section({ icon, tint, title, subtitle, children }: { icon: React.ReactNode; tint: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="bg-gray-900 rounded-md border border-gray-800">
      <div className="p-6 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-md ${tint} flex items-center justify-center`}>{icon}</div>
          <div><h2 className="text-lg font-semibold text-white">{title}</h2>{subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}</div>
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
