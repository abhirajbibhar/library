import { Link } from 'react-router-dom';
import type { PdfDocument } from '../types';
import { coverColor, progressLabel, progressPct, viewerPath } from '../lib/format';

/** A book on a shelf: coloured cover (title + progress strip) with the reading status beneath. */
export default function BookCover({ doc, className = '' }: { doc: PdfDocument; className?: string }) {
  const pct = progressPct(doc);
  return (
    <Link
      to={viewerPath(doc.id)}
      aria-label={`${doc.name}, ${progressLabel(doc)}`}
      className={`focus-ring block rounded-xl transition-opacity hover:opacity-90 ${className}`}
    >
      <div
        className="flex aspect-[3/4] flex-col justify-between rounded-xl p-3.5 text-white shadow-lg shadow-slate-900/20"
        style={{ backgroundColor: coverColor(doc.name) }}
      >
        <span className="line-clamp-5 text-[15px] font-bold leading-snug sm:text-base">{doc.name}</span>
        <div className="h-1 rounded-full bg-white/35">
          <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="mute mt-2.5">{progressLabel(doc)}</div>
    </Link>
  );
}
