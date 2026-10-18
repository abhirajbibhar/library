import type { PdfDocument } from '../types';
import { progressPct, statusOf, type DocStatus } from './format';

export type DocFilter = 'all' | DocStatus | 'fav';
export type DocSort = 'recent' | 'title' | 'progress';

export const FILTER_LABELS: Record<DocFilter, string> = {
  all: 'All',
  reading: 'In progress',
  new: 'Not started',
  done: 'Finished',
  fav: 'Favourites',
};
export const FILTERS: DocFilter[] = ['all', 'reading', 'new', 'done', 'fav'];

const byTitle = (a: PdfDocument, b: PdfDocument) => a.name.localeCompare(b.name, undefined, { numeric: true });
const opened = (d: PdfDocument) => (d.lastOpened ? Date.parse(d.lastOpened) : 0);

export function sortDocs(docs: PdfDocument[], sort: DocSort): PdfDocument[] {
  const out = [...docs];
  if (sort === 'title') return out.sort(byTitle);
  if (sort === 'progress') return out.sort((a, b) => progressPct(b) - progressPct(a) || byTitle(a, b));
  return out.sort((a, b) => opened(b) - opened(a) || byTitle(a, b));
}

export function filterDocs(docs: PdfDocument[], query: string, filter: DocFilter, tag = ''): PdfDocument[] {
  const q = query.trim().toLowerCase();
  return docs.filter((d) => {
    if (filter === 'fav' ? !d.favorite : filter !== 'all' && statusOf(d) !== filter) return false;
    if (tag && !d.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return false;
    return !q || d.name.toLowerCase().includes(q) || d.tags.some((t) => t.toLowerCase().includes(q));
  });
}

export function countByFilter(docs: PdfDocument[]): Record<DocFilter, number> {
  const c: Record<DocFilter, number> = { all: docs.length, reading: 0, new: 0, done: 0, fav: 0 };
  for (const d of docs) {
    c[statusOf(d)] += 1;
    if (d.favorite) c.fav += 1;
  }
  return c;
}

/** Every tag in use, most used first. */
export function allTags(docs: PdfDocument[]): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const d of docs) {
    for (const t of d.tags) {
      const k = t.toLowerCase();
      counts.set(k, { label: counts.get(k)?.label ?? t, n: (counts.get(k)?.n ?? 0) + 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).map((x) => x.label);
}

export interface Shelf {
  folder: string;
  title: string;
  docs: PdfDocument[];
}

/** One shelf per R2 folder, discovered from the data. */
export function groupByFolder(docs: PdfDocument[]): Shelf[] {
  const map = new Map<string, Shelf>();
  for (const d of docs) {
    const shelf = map.get(d.folder) ?? { folder: d.folder, title: d.folderTitle || d.folder, docs: [] };
    shelf.docs.push(d);
    map.set(d.folder, shelf);
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
}
