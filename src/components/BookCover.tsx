import { Link } from 'react-router-dom';
import type { PdfDocument } from '../types';
import { coverColor, progressLabel, progressPct, viewerPath } from '../lib/format';
import Menu from './Menu';

/** A book on a shelf: coloured cover (title + progress strip), reading status and a small ⋯ menu beneath. */
export default function BookCover({ doc, className = '', onDelete }: { doc: PdfDocument; className?: string; onDelete?: (doc: PdfDocument) => void }) {
  const pct = progressPct(doc);
  return (
    <div className={className}>
      <Link
        to={viewerPath(doc.id)}
        aria-label={`${doc.name}, ${progressLabel(doc)}`}
        className="focus-ring block rounded-xl transition-opacity hover:opacity-90"
      >
        <div
          className="flex aspect-[3/4] flex-col justify-between rounded-xl p-3.5 text-white shadow-md shadow-slate-900/15"
          style={{ backgroundColor: coverColor(doc.name) }}
        >
          <span className="line-clamp-5 text-[15px] font-bold leading-snug sm:text-base">{doc.name}</span>
          <div className="h-1 rounded-full bg-white/35">
            <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </Link>
      <div className="mt-1 flex items-center justify-between gap-1">
        <span className="mute truncate">{progressLabel(doc)}</span>
        <div className="-mr-2.5">
          <Menu
            label={`Options for ${doc.name}`}
            entries={[
              { label: 'Open', icon: 'book', to: viewerPath(doc.id) },
              ...(onDelete ? [{ label: 'Delete', icon: 'trash' as const, danger: true, onSelect: () => onDelete(doc) }] : []),
            ]}
          />
        </div>
      </div>
    </div>
  );
}
