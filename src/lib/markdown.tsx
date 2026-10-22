import type { ReactNode } from 'react';

/**
 * A small, safe Markdown renderer for the notebook preview: headings, lists, task lists, quotes, code,
 * bold, italic, links and [[wiki links]]. It builds React elements (never raw HTML), so nothing typed
 * into a note can run as a script.
 */
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`;
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={k} className="px-1 py-0.5 rounded bg-gray-800 text-gray-200 text-[0.9em]">{part.slice(1, -1)}</code>;
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={k} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    if (part.startsWith('[[') && part.endsWith(']]')) return <span key={k} className="text-purple-300">{part.slice(2, -2)}</span>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={k}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const safe = /^(https?:|mailto:)/i.test(link[2]);
      return safe ? <a key={k} href={link[2]} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">{link[1]}</a> : <span key={k}>{link[1]}</span>;
    }
    return part;
  });
}

export function renderMarkdown(md: string): ReactNode {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  const key = () => `b${n++}`;

  // front matter is metadata, not content
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, idx) => idx > 0 && l.trim() === '---');
    if (end > 0) i = end + 1;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(<pre key={key()} className="my-3 p-3 rounded-md bg-gray-800 text-sm text-gray-200 overflow-x-auto"><code>{code.join('\n')}</code></pre>);
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = ['text-2xl font-bold mt-2 mb-3', 'text-xl font-semibold mt-5 mb-2', 'text-lg font-semibold mt-4 mb-2', 'text-base font-semibold mt-3 mb-1'][level - 1];
      out.push(<div key={key()} role="heading" aria-level={level} className={`${cls} text-white`}>{inline(h[2], `h${n}`)}</div>);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push(<hr key={key()} className="my-4 border-gray-800" />); i++; continue; }

    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(<blockquote key={key()} className="my-3 pl-4 border-l-2 border-gray-700 text-gray-400">{inline(q.join(' '), `q${n}`)}</blockquote>);
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i])!;
        const indent = Math.min(4, Math.floor(m[1].length / 2));
        const task = /^\[([ xX/])\]\s?(.*)$/.exec(m[3]);
        const text = task ? task[2] : m[3];
        items.push(
          <li key={`${n}-${i}`} className="flex gap-2 py-0.5" style={{ marginLeft: `${indent * 1.25}rem` }}>
            {task ? (
              <span aria-hidden="true" className={`mt-1 w-4 h-4 shrink-0 rounded border text-[10px] leading-[14px] text-center ${task[1].toLowerCase() === 'x' ? 'bg-green-600 border-green-600 text-white' : task[1] === '/' ? 'border-amber-500 text-amber-400' : 'border-gray-600'}`}>
                {task[1].toLowerCase() === 'x' ? '✓' : task[1] === '/' ? '–' : ''}
              </span>
            ) : (
              <span aria-hidden="true" className="text-gray-500 select-none">{/\d/.test(m[2]) ? m[2] : '•'}</span>
            )}
            <span className={task && task[1].toLowerCase() === 'x' ? 'text-gray-500 line-through' : ''}>{inline(text, `li${n}-${i}`)}</span>
          </li>,
        );
        i++;
      }
      out.push(<ul key={key()} className="my-2">{items}</ul>);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+\.)\s+|-{3,}\s*$)/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={key()} className="my-2 leading-relaxed text-gray-300 whitespace-pre-line">{inline(para.join('\n'), `p${n}`)}</p>);
  }
  return <>{out}</>;
}
