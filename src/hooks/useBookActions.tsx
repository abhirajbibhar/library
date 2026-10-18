import type { ReactNode } from 'react';
import { useLibraryStore } from '../store';
import { useDocActions, type DocChange } from './useDocActions';
import type { Book } from '../types';
import type { MenuEntry } from '../components/Menu';

/**
 * Menu entries and dialogs for a book (favourite, rename, move, tags, version history, cover, delete).
 * Render `dialog` once on the page; call `menuFor(book)` for each book's menu.
 */
export function useBookActions(onChanged?: (change: DocChange) => void): { menuFor: (book: Book) => MenuEntry[]; menuForFolder: (folder: string) => MenuEntry[]; dialog: ReactNode } {
  const { docs, refresh } = useLibraryStore();
  const { menuForDoc, menuForFolder, dialog } = useDocActions(docs, (c) => {
    void refresh(true);
    onChanged?.(c);
  });
  return {
    menuFor: (book) => {
      const doc = docs.find((d) => d.id === book.r2Key);
      return doc ? menuForDoc(doc) : [];
    },
    menuForFolder: (folder) => {
      const inFolder = docs.filter((d) => d.folder === folder);
      return menuForFolder(folder, inFolder[0]?.folderTitle || folder, inFolder);
    },
    dialog,
  };
}
