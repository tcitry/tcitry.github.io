// These navigation pages belong to the site, not the Markdown knowledge base.
// Keep their published metadata, including modification dates, through the move.
const definitions = [
  { name: 'archives', title: 'archives', type: 'archives', layout: 'list', toc: true, lastmod: '2025-05-19T12:28:45.000Z', params: { type: 'archives', layout: 'list', legacySortTitle: '' } },
  { name: 'ghstar', title: 'ghstar', type: 'ghstar', layout: 'list', toc: false, lastmod: '2025-08-22T07:33:40.000Z', params: { layout: 'list', type: 'ghstar', booktoc: false, legacySortTitle: '' } },
  { name: 'modified', title: 'modified', type: 'archives', layout: 'modified', toc: true, lastmod: '2025-05-21T13:50:46.000Z', params: { type: 'archives', layout: 'modified', legacySortTitle: '' } },
  { name: 'portfolio', title: 'Portfolio', type: 'portfolio', layout: 'list', toc: false, lastmod: '2025-11-19T08:55:31.000Z', params: { title: 'Portfolio', type: 'portfolio', booktoc: false, layout: 'list', legacySortTitle: 'Portfolio' } },
  { name: 'timeline', title: 'Timeline', type: 'timeline', layout: 'list', toc: true, lastmod: '2025-11-19T06:55:07.000Z', params: { type: 'timeline', layout: 'list', title: 'Timeline', booktoc: true, legacySortTitle: 'Timeline' } },
];

export function addSitePages(contentPages) {
  const sitePages = definitions.map(({ name, params, ...metadata }) => ({
    id: `@site:${name}`, source: '', url: `/${name}/`, kind: 'page', section: '', parent: '/',
    date: '', description: '', summary: '', html: '', headings: [], tags: [], categories: [], aliases: [],
    weight: 0, hidden: false, collapse: false, image: '', link: '', redirect: false, wordCount: 0,
    ...metadata, params: { ...params, siteOwned: true },
  }));
  for (const page of sitePages) {
    const conflict = contentPages.find((candidate) => candidate.url === page.url);
    if (conflict) throw new Error(`Content source ${conflict.source || conflict.id} conflicts with site-owned route ${page.url}. Maintain this page in scripts/site-pages.mjs.`);
  }
  return [...contentPages, ...sitePages];
}
