import { useSyncExternalStore } from 'react';
import {
  getAllAnnotations,
  getAnnotations,
  getCollections,
  getQuotes,
  saveQuotes,
  getLibrary,
  getReading,
  getStorage,
  moveDocument,
  patchAnnotations,
  saveCollections,
  setDocState,
  setReadingGoal,
  trashDocument,
} from '../lib/db';
import { coverUrl } from '../lib/cover';
import { bookIdFor, formatSize, localDay, progressPct, readingStreak } from '../lib/format';
export { bookIdFor };
import { keyOf } from '../lib/names';
import type { Annotation, AnnotationSummary, Book, Collection, CollectionRecord, DocMeta, LibraryStats, PdfDocument, ReadingLog, StorageOverview, UserQuote } from '../types';

/**
 * One store for the whole app. Everything here comes from the Worker (your R2 bucket): books are your PDFs,
 * annotations are the highlights and notes saved while reading, collections are your own groups.
 * Pages call `useLibraryStore()` and use the data and actions below.
 */

// ---------------------------------------------------------------- state
interface Data {
  docs: PdfDocument[];
  books: Book[];
  annotations: Annotation[];
  collections: Collection[];
  quotes: UserQuote[];
  reading: ReadingLog | null;
  storage: StorageOverview | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  searchQuery: string;
  activeFilter: string; // 'all' or a collection id
  notice: string | null;
}

interface Actions {
  refresh: (silent?: boolean) => Promise<void>;
  getBook: (id: string) => Book | undefined;
  getAnnotationsByBook: (bookId: string) => Annotation[];
  getStats: () => LibraryStats;
  // books
  updateBookDetails: (id: string, details: DocMeta) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  setTags: (id: string, tags: string[]) => Promise<void>;
  renameBook: (id: string, title: string) => Promise<string>;
  moveBook: (id: string, folder: string) => Promise<string>;
  trashBook: (id: string) => Promise<void>;
  // annotations
  updateAnnotation: (id: string, change: { comment: string }) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
  // collections
  addCollection: (c: { name: string; description?: string; icon?: string; color?: string; bookIds?: string[] }) => Promise<string>;
  updateCollection: (id: string, change: Partial<Pick<Collection, 'name' | 'description' | 'icon' | 'color'>>) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  addBookToCollection: (collectionId: string, bookId: string) => Promise<void>;
  removeBookFromCollection: (collectionId: string, bookId: string) => Promise<void>;
  // quotes you picked (saved to _library/quotes.json)
  saveQuote: (q: Omit<UserQuote, 'id' | 'addedAt'> & { id?: string }) => Promise<void>;
  deleteQuote: (id: string) => Promise<void>;
  importQuotes: (list: UserQuote[]) => Promise<number>;
  // reading goal
  setDailyGoal: (minutes: number) => Promise<void>;
  // ui
  setSearchQuery: (q: string) => void;
  setActiveFilter: (f: string) => void;
  showNotice: (message: string) => void;
}

export type LibraryStore = Data & Actions;

let records: CollectionRecord[] = []; // collections exactly as stored (PDF keys, including trashed books)
let state = {
  docs: [], books: [], annotations: [], collections: [], quotes: [], reading: null, storage: null,
  loaded: false, loading: false, error: null, searchQuery: '', activeFilter: 'all', notice: null,
} as unknown as LibraryStore;
const listeners = new Set<() => void>();

function patch(change: Partial<Data>) {
  state = { ...state, ...change } as LibraryStore;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// ---------------------------------------------------------------- mapping
function toBook(d: PdfDocument, collectionIds: string[]): Book {
  return {
    id: bookIdFor(d.id),
    r2Key: d.id,
    title: d.name,
    author: d.meta?.author ?? '',
    cover: coverUrl(d) ?? '',
    description: d.meta?.description ?? '',
    genre: d.folderTitle || d.folder,
    folder: d.folder,
    pages: d.totalPages,
    publishedYear: d.meta?.publishedYear,
    isbn: d.meta?.isbn,
    language: d.meta?.language,
    fileSize: formatSize(d.size),
    size: d.size,
    format: 'pdf',
    addedAt: d.lastModified,
    lastReadAt: d.lastOpened ?? undefined,
    lastPage: d.lastPage,
    progress: progressPct(d),
    rating: d.meta?.rating,
    favorite: d.favorite,
    tags: d.tags,
    readingSeconds: d.readingTime,
    collectionIds,
  };
}

function toAnnotation(a: AnnotationSummary): Annotation {
  const highlight = !!a.text.trim();
  return {
    id: `${a.docId}::${a.id}`,
    annotationId: a.id,
    bookId: bookIdFor(a.docId),
    r2Key: a.docId,
    type: highlight ? 'highlight' : 'note',
    content: highlight ? a.text.trim() : a.note.trim(),
    comment: highlight ? a.note.trim() : '',
    page: a.page,
    color: a.color ?? undefined,
    createdAt: a.created,
    updatedAt: a.modified || a.created,
  };
}

/** Rebuilds books and collections from the raw records (after a load or any change to them). */
function derive(docs: PdfDocument[]): Pick<Data, 'docs' | 'books' | 'collections'> {
  const keyToId = new Map(docs.map((d) => [d.id, bookIdFor(d.id)]));
  const memberOf = new Map<string, string[]>();
  for (const r of records) for (const k of r.bookIds) memberOf.set(k, [...(memberOf.get(k) ?? []), r.id]);
  return {
    docs,
    books: docs.map((d) => toBook(d, memberOf.get(d.id) ?? [])),
    collections: records.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      icon: r.icon,
      color: r.color,
      createdAt: r.createdAt,
      bookIds: r.bookIds.map((k) => keyToId.get(k)).filter((x): x is string => !!x),
    })),
  };
}

// ---------------------------------------------------------------- loading
let lastRefresh = 0;

async function refresh(silent = false): Promise<void> {
  if (!silent) patch({ loading: true });
  try {
    const [docs, anns, cols, reading, storage, quotes] = await Promise.all([
      getLibrary(),
      getAllAnnotations().catch(() => null),
      getCollections().catch(() => null),
      getReading().catch(() => null),
      getStorage().catch(() => null),
      getQuotes().catch(() => null),
    ]);
    if (cols) records = cols;
    lastRefresh = Date.now();
    patch({
      ...derive(docs),
      annotations: anns ? anns.map(toAnnotation) : state.annotations,
      quotes: quotes ?? state.quotes,
      reading: reading ?? state.reading,
      storage: storage ?? state.storage,
      loaded: true,
      loading: false,
      error: null,
    });
  } catch (err) {
    console.error(err);
    patch({ loading: false, loaded: state.loaded, error: err instanceof Error ? err.message : 'Could not load your library' });
  }
}

/** Reload quietly when the tab comes back, at most every 20 seconds. */
export function refreshIfStale(): void {
  if (Date.now() - lastRefresh > 20_000) void refresh(true);
}

// ---------------------------------------------------------------- actions
const bookById = (id: string) => state.books.find((b) => b.id === id);

let quoteChain: Promise<unknown> = Promise.resolve();
/** Saves the quotes file one request at a time. Rolls the screen back if the save fails. */
function persistQuotes(next: UserQuote[]): Promise<void> {
  const previous = state.quotes;
  patch({ quotes: next });
  quoteChain = quoteChain.then(() => saveQuotes(next)).catch((err) => {
    console.error(err);
    patch({ quotes: previous, notice: 'Couldn’t save your quotes. Check your connection.' });
  });
  return quoteChain as Promise<void>;
}

let saveChain: Promise<unknown> = Promise.resolve();
/** Saves collections one request at a time so quick successive edits can't overwrite each other. */
function persistCollections(): Promise<void> {
  const snapshot = records;
  saveChain = saveChain.then(() => saveCollections(snapshot)).catch((err) => {
    console.error(err);
    patch({ notice: 'Couldn’t save your collections. Check your connection.' });
  });
  return saveChain as Promise<void>;
}

function editCollections(change: (r: CollectionRecord[]) => CollectionRecord[]): Promise<void> {
  records = change(records);
  patch(derive(state.docs));
  return persistCollections();
}

const actions: Actions = {
  refresh,
  getBook: (id) => bookById(id),
  getAnnotationsByBook: (bookId) => state.annotations.filter((a) => a.bookId === bookId),

  getStats: () => {
    const { books, annotations, reading } = state;
    const opened = books.filter((b) => b.pages > 0);
    const week = new Date();
    let thisWeekSeconds = 0;
    for (let i = 0; i < 7; i++) {
      thisWeekSeconds += reading?.days[localDay(week)] ?? 0;
      week.setDate(week.getDate() - 1);
    }
    return {
      totalBooks: books.length,
      booksRead: books.filter((b) => b.progress >= 100).length,
      currentlyReading: opened.filter((b) => b.progress < 100).length,
      totalPages: opened.reduce((n, b) => n + b.lastPage, 0),
      totalNotes: annotations.filter((a) => a.type === 'note').length,
      totalHighlights: annotations.filter((a) => a.type === 'highlight').length,
      streak: reading ? readingStreak(reading.days) : 0,
      thisWeekSeconds,
    };
  },

  updateBookDetails: async (id, details) => {
    const b = bookById(id);
    if (!b) return;
    const meta: DocMeta = {
      author: b.author, description: b.description, publishedYear: b.publishedYear, language: b.language, isbn: b.isbn, rating: b.rating,
      ...details,
    };
    patch({ books: state.books.map((x) => (x.id === id ? { ...x, ...details } : x)) }); // instant feedback
    await setDocState(b.r2Key, { meta });
    await refresh(true);
  },

  toggleFavorite: async (id) => {
    const b = bookById(id);
    if (!b) return;
    patch({ books: state.books.map((x) => (x.id === id ? { ...x, favorite: !x.favorite } : x)) });
    await setDocState(b.r2Key, { favorite: !b.favorite });
    await refresh(true);
  },

  setTags: async (id, tags) => {
    const b = bookById(id);
    if (!b) return;
    await setDocState(b.r2Key, { tags });
    await refresh(true);
  },

  renameBook: async (id, title) => {
    const b = bookById(id);
    if (!b) throw new Error('Book not found');
    const key = await moveDocument(b.r2Key, keyOf(b.folder, title));
    await refresh(true);
    return bookIdFor(key);
  },

  moveBook: async (id, folder) => {
    const b = bookById(id);
    if (!b) throw new Error('Book not found');
    const key = await moveDocument(b.r2Key, keyOf(folder, b.r2Key.split('/').pop()!));
    await refresh(true);
    return bookIdFor(key);
  },

  trashBook: async (id) => {
    const b = bookById(id);
    if (!b) return;
    await trashDocument(b.r2Key);
    await refresh(true);
  },

  updateAnnotation: async (id, change) => {
    const a = state.annotations.find((x) => x.id === id);
    if (!a) return;
    const sidecar = await getAnnotations(a.r2Key);
    const stored = sidecar.annotations[a.annotationId];
    if (!stored) throw new Error('That annotation no longer exists');
    const comment = change.comment.trim();
    await patchAnnotations(a.r2Key, [
      {
        op: 'upsert',
        id: stored.id,
        page: stored.page,
        type: stored.type,
        text: stored.text,
        note: comment,
        // The viewer reads the note from `contents`, so change it there too or it would show the old text.
        data: { ...stored.data, contents: comment, modified: new Date().toISOString() },
      },
    ]);
    await refresh(true);
  },

  deleteAnnotation: async (id) => {
    const a = state.annotations.find((x) => x.id === id);
    if (!a) return;
    patch({ annotations: state.annotations.filter((x) => x.id !== id) });
    await patchAnnotations(a.r2Key, [{ op: 'delete', id: a.annotationId }]);
    await refresh(true);
  },

  addCollection: async (c) => {
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const keys = (c.bookIds ?? []).map((bid) => bookById(bid)?.r2Key).filter((k): k is string => !!k);
    await editCollections((r) => [
      ...r,
      { id, name: c.name.trim(), description: c.description ?? '', icon: c.icon ?? '📚', color: c.color ?? '#3b82f6', bookIds: keys, createdAt: new Date().toISOString() },
    ]);
    return id;
  },

  updateCollection: (id, change) => editCollections((r) => r.map((c) => (c.id === id ? { ...c, ...change } : c))),
  deleteCollection: (id) => editCollections((r) => r.filter((c) => c.id !== id)),

  addBookToCollection: async (collectionId, bookId) => {
    const key = bookById(bookId)?.r2Key;
    if (!key) return;
    await editCollections((r) => r.map((c) => (c.id === collectionId && !c.bookIds.includes(key) ? { ...c, bookIds: [...c.bookIds, key] } : c)));
  },

  removeBookFromCollection: async (collectionId, bookId) => {
    const key = bookById(bookId)?.r2Key;
    if (!key) return;
    await editCollections((r) => r.map((c) => (c.id === collectionId ? { ...c, bookIds: c.bookIds.filter((k) => k !== key) } : c)));
  },

  saveQuote: async (q) => {
    const id = q.id ?? `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const existing = state.quotes.find((x) => x.id === id);
    const record: UserQuote = { ...q, id, addedAt: existing?.addedAt ?? new Date().toISOString() };
    await persistQuotes(existing ? state.quotes.map((x) => (x.id === id ? record : x)) : [record, ...state.quotes]);
  },

  deleteQuote: async (id) => {
    await persistQuotes(state.quotes.filter((q) => q.id !== id));
  },

  importQuotes: async (list) => {
    const have = new Set(state.quotes.map((q) => `${q.text.trim()}|${q.author.trim()}`.toLowerCase()));
    const fresh = list
      .filter((q) => q && typeof q.text === 'string' && q.text.trim())
      .filter((q) => !have.has(`${q.text.trim()}|${(q.author ?? '').trim()}`.toLowerCase()))
      .map((q): UserQuote => ({
        id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        text: q.text.trim(),
        author: (q.author ?? '').trim(),
        book: (q.book ?? '').trim(),
        year: typeof q.year === 'number' ? q.year : null,
        page: typeof q.page === 'number' ? q.page : null,
        note: (q.note ?? '').trim(),
        bookKey: '',
        addedAt: new Date().toISOString(),
      }));
    if (fresh.length) await persistQuotes([...fresh, ...state.quotes]);
    return fresh.length;
  },

  setDailyGoal: async (minutes) => {
    await setReadingGoal(minutes);
    await refresh(true);
  },

  setSearchQuery: (q) => patch({ searchQuery: q }),
  setActiveFilter: (f) => patch({ activeFilter: f }),
  showNotice: (message) => {
    patch({ notice: message });
    setTimeout(() => state.notice === message && patch({ notice: null }), 4000);
  },
};

state = { ...state, ...actions } as LibraryStore;

/** `const { books, addCollection } = useLibraryStore()` – the same shape the pages were designed with. */
export function useLibraryStore(): LibraryStore {
  return useSyncExternalStore(subscribe, () => state);
}
useLibraryStore.getState = (): LibraryStore => state;

