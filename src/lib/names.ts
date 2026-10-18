/** Name rules shared by upload, rename and move. They mirror what the Worker accepts (assertPdfKey). */

export function folderNameError(name: string): string | null {
  if (!name) return 'Enter a folder name.';
  if (name.length > 100) return 'Use 100 characters or fewer.';
  if (/[\\/\u0000-\u001f]/.test(name)) return 'Folder names can’t contain slashes.';
  if (name.includes('..')) return 'Folder names can’t contain “..”.';
  if (name.startsWith('_') || name.startsWith('.')) return 'Folder names can’t start with “_” or “.”.';
  if (name.toLowerCase() === 'annotation') return '“Annotation” is reserved for your notes.';
  return null;
}

/** `name` is the title without “.pdf”. */
export function fileNameError(name: string): string | null {
  if (!name) return 'Enter a name.';
  if (name.length > 150) return 'Use 150 characters or fewer.';
  if (/[\\/\u0000-\u001f]/.test(name)) return 'Names can’t contain slashes.';
  if (name.includes('..')) return 'Names can’t contain “..”.';
  return null;
}

export const withPdf = (name: string) => (/\.pdf$/i.test(name) ? name : `${name}.pdf`);
export const keyOf = (folder: string, fileName: string) => `${folder}/${withPdf(fileName)}`;
