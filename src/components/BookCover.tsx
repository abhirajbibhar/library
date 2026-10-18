import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PdfDocument } from '../types';
import { coverUrl } from '../lib/cover';
import { coverColor, progressLabel, progressPct, viewerPath } from '../lib/format';
import { Icon } from './Icon';
import Menu, { type MenuEntry } from './Menu';

/** A book on a shelf: its cover (page 1, or a colour with the title), a progress strip, status and a ⋯ menu. */
export default function BookCover({ doc, className = '', menu }: { doc: PdfDocument; className?: string; menu?: MenuEntry[] }) {
  const pct = progressPct(doc);
  const src = coverUrl(doc);
  const [broken, setBroken] = useState(false);
  const showImage = !!src && !broken;
  return (
    <div className={className}>
      <Link
        to={viewerPath(doc.id)}
        aria-label={`${doc.name}, ${progressLabel(doc)}${doc.favorite ? ', favourite' : ''}`}
        className="focus-ring block rounded-xl transition-opacity hover:opacity-90"
      >
        <div
          className="relative flex aspect-[3/4] flex-col justify-between overflow-hidden rounded-xl p-3.5 text-white shadow-md shadow-slate-900/15"
          style={{ backgroundColor: coverColor(doc.name) }}
        >
          {showImage ? (
            <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="line-clamp-5 text-[15px] font-bold leading-snug sm:text-base">{doc.name}</span>
          )}
          {doc.favorite && (
            <span className="absolute right-2 top-2 rounded-full bg-black/45 p-1.5" aria-hidden="true">
              <Icon name="star" filled className="h-3.5 w-3.5 text-amber-300" />
            </span>
          )}
          <div className="relative mt-auto h-1 rounded-full bg-white/40 shadow-sm">
            <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </Link>
      <div className="mt-1 flex items-center justify-between gap-1">
        <span className="mute truncate">{progressLabel(doc)}</span>
        {menu && (
          <div className="-mr-2.5">
            <Menu label={`Options for ${doc.name}`} entries={menu} />
          </div>
        )}
      </div>
    </div>
  );
}
