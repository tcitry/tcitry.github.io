import generated from '../../.generated/content.json';
import type { ContentPage, NavigationNode, PageView, SiteContent, TaxonomyTerm } from './types';

export const content = generated as SiteContent;
export function createPage(overrides: Partial<ContentPage> = {}): ContentPage {
  return {
    id: '', source: '', url: '/', title: "LYon's Blog", kind: 'page',
    section: '', type: '', layout: '', date: '', lastmod: '', description: '',
    summary: '', html: '', headings: [], tags: [], categories: [], aliases: [],
    weight: 0, hidden: false, collapse: true, toc: true, image: '', link: '',
    redirect: false, parent: '', wordCount: 0, params: {}, ...overrides,
  };
}

const dateValue = (value: string) => Date.parse(value) || 0;
// Hugo's Chinese collator puts ASCII titles before Han titles; browser Intl
// defaults put Han first. Preserve the existing menu and equal-date ordering.
export const compareLegacyTitles = (a: string, b: string) =>
  Number(!/^$|^[\x00-\x7f]/.test(a)) - Number(!/^$|^[\x00-\x7f]/.test(b)) || a.localeCompare(b, 'zh-CN');
const sortTitle = (page: ContentPage) => String(page.params.legacySortTitle ?? page.params.linktitle ?? page.title);
export const byDate = (a: ContentPage, b: ContentPage) =>
  dateValue(b.date) - dateValue(a.date) || compareLegacyTitles(sortTitle(a), sortTitle(b));
const byMenu = (a: ContentPage, b: ContentPage) => {
  const aWeight = a.weight || Number.MAX_SAFE_INTEGER;
  const bWeight = b.weight || Number.MAX_SAFE_INTEGER;
  return aWeight - bWeight || byDate(a, b);
};
export const regularPages = content.pages.filter(p => p.kind === 'page');

function buildNavigation(): NavigationNode[] {
  const nodes = new Map<string, NavigationNode>();
  // Build the complete tree before pruning: removing hidden parents first would
  // incorrectly promote their descendants to the visible root navigation.
  for (const page of content.pages.filter(p => p.section === 'docs')) {
    nodes.set(page.id, { page, children: [] });
  }
  const roots: NavigationNode[] = [];
  const urlNodes = new Map([...nodes.values()].map(node => [node.page.url, node]));
  const sourceNodes = new Map([...nodes.values()].map(node => [node.page.source, node]));
  for (const node of nodes.values()) {
    if (node.page.url === '/docs/') continue;
    const parent = nodes.get(node.page.parent) || urlNodes.get(node.page.parent) || sourceNodes.get(node.page.parent);
    if (parent && parent.page.url !== '/docs/' && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (items: NavigationNode[]) => {
    items.sort((a, b) => byMenu(a.page, b.page));
    items.forEach(item => sort(item.children));
  };
  const visible = (items: NavigationNode[]): NavigationNode[] => items
    .filter(node => !node.page.hidden && (node.page.kind === 'section' || Boolean(node.page.html)))
    .map(node => ({ ...node, children: visible(node.children) }));
  const result = visible(roots);
  sort(result);
  return result;
}
export const navigation = buildNavigation();

const archiveTypes = new Set(['docs', 'posts', 'weekly']);
function entriesFor(page: ContentPage): ContentPage[] {
  if (page.kind === 'home') return regularPages.filter(p => p.type === 'posts' && p.date).sort(byDate);
  if (page.type === 'archives' || page.url === '/archives/' || page.url === '/modified/') {
    const entries = regularPages.filter(p => p.date && (archiveTypes.has(p.type) || ((page.layout === 'modified' || page.url === '/modified/') && p.type === 'links')));
    return entries.sort(page.layout === 'modified' || page.url === '/modified/' ?
      (a, b) => dateValue(b.lastmod) - dateValue(a.lastmod) || byDate(a, b) : byDate);
  }
  if (page.type === 'timeline') return regularPages.filter(p => p.type === 'timeline' && dateValue(p.date) >= Date.parse('2000-01-01')).sort(byDate);
  if (page.kind === 'section') {
    if (page.url === '/posts/') return regularPages.filter(p => p.type === 'posts' && p.date).sort(byDate);
    if (page.url === '/weekly/') return regularPages.filter(p => p.type === 'weekly' && p.date).sort(byDate);
    if (page.url === '/links/') return regularPages.filter(p => p.type === 'links').sort(byDate);
    if (page.section === 'docs') return content.pages.filter(p => p.parent === page.id || p.parent === page.url || p.parent === page.source).filter(p => !p.hidden).sort(byMenu);
    return regularPages.filter(p => p.section === page.section && p.url.startsWith(page.url)).sort(byDate);
  }
  return [];
}

export function buildViews(): PageView[] {
  const views: PageView[] = [];
  const urls = new Set<string>();
  const push = (view: PageView) => {
    if (urls.has(view.page.url)) return;
    urls.add(view.page.url);
    views.push(view);
  };
  for (const page of content.pages) {
    if (page.kind === 'taxonomy' || page.kind === 'term') continue;
    const entries = entriesFor(page);
    const pageSize = page.kind === 'home' ? 10 : page.kind === 'section' && page.type === 'weekly' ? 100 : 0;
    const total = pageSize ? Math.max(1, Math.ceil(entries.length / pageSize)) : 1;
    const paginationUrls = Array.from({ length: total }, (_, index) => index === 0 ? page.url : `${page.url}page/${index + 1}/`);
    for (let index = 0; index < total; index++) {
      push({
        page: index === 0 ? page : { ...page, id: `${page.id}:page:${index + 1}`, url: paginationUrls[index], aliases: [] },
        entries: pageSize ? entries.slice(index * pageSize, (index + 1) * pageSize) : entries,
        ...(pageSize ? { pagination: { current: index + 1, total, urls: paginationUrls } } : {}),
      });
    }
  }
  for (const taxonomy of ['tags', 'categories'] as const) {
    const sourceIndex = content.pages.find(page => page.url === `/${taxonomy}/`);
    push({ page: createPage({ ...sourceIndex, id: taxonomy, url: `/${taxonomy}/`, title: taxonomy === 'tags' ? 'Tags' : 'Categories', kind: 'taxonomy', section: taxonomy, type: taxonomy }), entries: [] });
    for (const term of content[taxonomy]) {
      const ids = new Set(term.pageIds);
      const entries = content.pages.filter(page => ids.has(page.id)).sort(byDate);
      push({ page: createPage({ id: `${taxonomy}:${term.name}`, url: term.url, title: term.name, kind: 'term', section: taxonomy, type: taxonomy }), entries, term });
    }
  }
  return views;
}

export function pagesForTerm(term: TaxonomyTerm) {
  const ids = new Set(term.pageIds);
  return content.pages.filter(page => ids.has(page.id)).sort(byDate);
}
