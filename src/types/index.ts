export * from './api';

/** A PDF as the app's pages see it (built from the Worker's document list). */
export interface Book {
  id: string; // short stable id used in routes
  r2Key: string; // the PDF's key in the bucket, e.g. "Writings/Annihilation of Caste.pdf"
  title: string;
  author: string;
  cover: string; // URL of the cover image, '' = none yet
  description: string;
  genre: string; // the folder it lives in
  folder: string;
  pages: number; // 0 until it has been opened once
  publishedYear?: number;
  isbn?: string;
  language?: string;
  fileSize: string;
  size: number;
  format: 'pdf';
  addedAt: string;
  lastReadAt?: string;
  lastPage: number;
  progress: number; // 0-100
  rating?: number;
  favorite: boolean;
  tags: string[];
  readingSeconds: number;
  collectionIds: string[];
}

/** One highlight or note, read from the per-PDF annotations file. */
export interface Annotation {
  id: string; // `${r2Key}::${annotationId}`
  annotationId: string;
  bookId: string;
  r2Key: string;
  type: 'highlight' | 'note';
  content: string; // highlighted text, or the note's text
  comment: string; // the note typed on a highlight, if any
  page: number;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  bookIds: string[]; // Book.id values (the store maps them to and from PDF keys)
  createdAt: string;
}

export interface LibraryStats {
  totalBooks: number;
  booksRead: number;
  currentlyReading: number;
  totalPages: number; // pages read so far
  totalNotes: number;
  totalHighlights: number;
  streak: number;
  thisWeekSeconds: number;
}
