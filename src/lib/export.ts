import type { AnnotationSummary } from '../types';

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
const day = (iso: string) => (iso ? iso.slice(0, 10) : '');

export function annotationsToMarkdown(items: AnnotationSummary[], title = 'Annotations'): string {
  const byDoc = new Map<string, AnnotationSummary[]>();
  for (const a of items) byDoc.set(a.docId, [...(byDoc.get(a.docId) ?? []), a]);
  const out = [`# ${title}`, '', `Exported ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, ''];
  for (const list of byDoc.values()) {
    out.push(`## ${list[0].docName}`, `*${list[0].folder}*`, '');
    for (const a of [...list].sort((x, y) => x.page - y.page)) {
      if (a.text.trim()) out.push(...a.text.trim().split('\n').map((l) => `> ${l}`));
      if (a.note.trim()) out.push(a.text.trim() ? '' : '', `**Note:** ${a.note.trim()}`);
      out.push('', `(page ${a.page}, ${day(a.modified || a.created)})`, '');
    }
  }
  return out.join('\n');
}

export function annotationsToCsv(items: AnnotationSummary[]): string {
  const rows = [['Document', 'Folder', 'Page', 'Type', 'Highlighted text', 'Note', 'Date']];
  for (const a of items) rows.push([a.docName, a.folder, String(a.page), a.text.trim() ? 'highlight' : 'note', a.text.trim(), a.note.trim(), day(a.modified || a.created)]);
  return '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'); // BOM so Excel reads UTF-8 (Odia, Pali…) correctly
}

export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
