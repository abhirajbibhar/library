import { FILTER_LABELS, FILTERS, type DocFilter, type DocSort } from '../lib/docs';
import Menu, { type MenuEntry } from './Menu';

const SORTS: { value: DocSort; label: string }[] = [
  { value: 'recent', label: 'Recently opened' },
  { value: 'title', label: 'Title' },
  { value: 'progress', label: 'Progress' },
];

/** One icon button that holds both the status filter and the sort order. */
export default function ViewMenu({
  filter,
  onFilter,
  sort,
  onSort,
  counts,
}: {
  filter: DocFilter;
  onFilter: (f: DocFilter) => void;
  sort: DocSort;
  onSort: (s: DocSort) => void;
  counts?: Record<DocFilter, number>;
}) {
  const entries: MenuEntry[] = [
    { heading: 'Show' },
    ...FILTERS.map((f) => ({
      label: FILTER_LABELS[f],
      checked: filter === f,
      meta: counts ? String(counts[f]) : undefined,
      keepOpen: true,
      onSelect: () => onFilter(f),
    })),
    { heading: 'Sort by' },
    ...SORTS.map((o) => ({ label: o.label, checked: sort === o.value, keepOpen: true, onSelect: () => onSort(o.value) })),
  ];
  return <Menu label="Filter and sort" icon="sliders" entries={entries} badge={filter !== 'all' || sort !== 'recent'} buttonClassName="btn-ghost btn-sq" />;
}
