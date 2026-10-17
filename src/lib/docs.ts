import type { PdfDocument } from '../types';
import { progressPct, statusOf, type DocStatus } from './format';

export type DocFilter = 'all' | DocStatus;
export type DocSort = 'recent' | 'title' | 'progress';

export const FILTER_LABELS: Record<DocFilter, string> = {
  all: 'All',
  reading: 'In progress',
  new: 'Not started',
  done: 'Finished',
};
export const FILTERS: DocFilter[] = ['all', 'reading', 'new', 'done'];

const byTitle = (a: PdfDocument, b: PdfDocument) => a.name.localeCompare(b.name, undefined, { numeric: true });
const opened = (d: PdfDocument) => (d.lastOpened ? Date.parse(d.lastOpened) : 0);

export function sortDocs(docs: PdfDocument[], sort: DocSort): PdfDocument[] {
  const out = [...docs];
  if (sort === 'title') return out.sort(byTitle);
  if (sort === 'progress') return out.sort((a, b) => progressPct(b) - progressPct(a) || byTitle(a, b));
  return out.sort((a, b) => opened(b) - opened(a) || byTitle(a, b));
}

export function filterDocs(docs: PdfDocument[], query: string, filter: DocFilter): PdfDocument[] {
  const q = query.trim().toLowerCase();
  return docs.filter(
    (d) => (filter === 'all' || statusOf(d) === filter) && (!q || d.name.toLowerCase().includes(q)),
  );
}

export function countByFilter(docs: PdfDocument[]): Record<DocFilter, number> {
  const c: Record<DocFilter, number> = { all: docs.length, reading: 0, new: 0, done: 0 };
  for (const d of docs) c[statusOf(d)] += 1;
  return c;
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
