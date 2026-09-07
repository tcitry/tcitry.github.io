import type { ContentPage, NavigationNode, Heading } from '../../lib/types';

export function param(page: ContentPage, name: string): unknown {
  return page.params[name] ?? page.params[name.toLowerCase()];
}
export function bookTitle(page: ContentPage): string {
  return String(param(page, 'linkTitle') || param(page, 'bookTitle') || page.title);
}
export function dateText(value: string, format: 'short' | 'long' | 'month' | 'dots' = 'short'): string {
  if (!value || value.startsWith('0001')) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (format === 'short') return date.toISOString().slice(0, 10);
  if (format === 'dots') return date.toISOString().slice(0, 10).replaceAll('-', '.');
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', ...(format === 'long' ? { day: 'numeric' as const } : {}), timeZone: 'UTC' }).format(date);
}
/** Match the existing Hugo head-title override, including source-directory prefixes. */
export function headTitle(page: ContentPage): string {
  const parts = page.source.replaceAll('\\', '/').split('/');
  const filename = (parts.pop() || '').replace(/\.(?:md|mdx)$/i, '');
  const directory = parts[parts.length - 1] || '';
  const titleCase = (value: string) => value.replace(/(^|[ _-])(\p{L})/gu, (_, prefix, letter) => prefix + letter.toLocaleUpperCase());
  if (page.type === 'docs' && page.source) {
    if (page.kind === 'section') return titleCase(directory);
    return page.title ? `${titleCase(directory)} — ${page.title}` : titleCase(filename);
  }
  if (page.type === 'weekly' && page.source) {
    if (page.kind === 'section') return titleCase(directory);
    return page.title ? `${filename} ${page.title}` : titleCase(filename);
  }
  return bookTitle(page);
}
/** Hugo uses the frontmatter date's own calendar day, even when it has an offset. */
export function displayDate(page: ContentPage, format: 'short' | 'dots' | 'month' | 'localized' = 'short', field: 'date' | 'lastmod' = 'date'): string {
  const raw = param(page, field);
  const original = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : dateText(page[field]);
  if (!original || original.startsWith('0001')) return '';
  if (format === 'short') return original;
  if (format === 'dots') return original.replaceAll('-', '.');
  const [year, month, day] = original.split('-').map(Number);
  if (format === 'localized') return `${month}月 ${day}, ${year}`;
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${original}T00:00:00Z`));
}
export function excerpt(value: string, length = 200): string {
  const characters = Array.from(value);
  return characters.length > length ? `${characters.slice(0, length).join('').trimEnd()} …` : value;
}
export function byDate(pages: ContentPage[]): ContentPage[] {
  return [...pages].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh-CN'));
}
export function groups(pages: ContentPage[], format: 'year' | 'month' = 'year') {
  const result: { key: string; pages: ContentPage[] }[] = [];
  for (const page of pages) {
    const key = displayDate(page).slice(0, format === 'year' ? 4 : 7) || '未标注日期';
    let group = result.find((item) => item.key === key);
    if (!group) { group = { key, pages: [] }; result.push(group); }
    group.pages.push(page);
  }
  return result;
}
export function flattenNavigation(nodes: NavigationNode[]): ContentPage[] {
  return nodes.flatMap((node) => [...(node.page.html && !node.page.hidden ? [node.page] : []), ...flattenNavigation(node.children)]);
}
export function includesPage(node: NavigationNode, id: string): boolean {
  return node.page.id === id || node.children.some((child) => includesPage(child, id));
}
export function breadcrumb(page: ContentPage): string {
  if (page.type !== 'docs') return '';
  const parts = page.source.replaceAll('\\', '/').split('/').slice(0, -1);
  const docsIndex = parts.findIndex((part) => part.toLowerCase() === 'docs');
  return parts.slice(Math.max(docsIndex + 1, parts.length - 2)).join(' » ');
}
export function timelineBlocks(page: ContentPage | undefined) {
  if (!page) return [];
  return [...page.html.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2\b|$)/g)].map((match) => ({
    id: /\bid="([^"]*)"/.exec(match[1])?.[1] || '',
    title: match[2].replace(/<a\b[^>]*class="anchor"[^>]*>[\s\S]*?<\/a>/g, '').replace(/<[^>]+>/g, '').replace(/\s*#\s*$/, '').trim(),
    html: match[3],
  }));
}
export interface HeadingNode extends Heading { children: HeadingNode[] }
export function headingTree(headings: Heading[]): HeadingNode[] {
  const root: HeadingNode = { depth: 0, slug: '', text: '', children: [] };
  const stack: HeadingNode[] = [root];
  for (const heading of headings.filter((h) => h.depth <= 4)) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= heading.depth) stack.pop();
    // Hugo's TOC preserves skipped levels, including H2 as the first heading.
    while (stack[stack.length - 1].depth < heading.depth - 1) {
      const placeholder: HeadingNode = { depth: stack[stack.length - 1].depth + 1, slug: '', text: '', children: [] };
      stack[stack.length - 1].children.push(placeholder); stack.push(placeholder);
    }
    const node: HeadingNode = { ...heading, children: [] };
    stack[stack.length - 1].children.push(node); stack.push(node);
  }
  return root.children;
}
