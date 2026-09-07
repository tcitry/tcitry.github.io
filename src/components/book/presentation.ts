import type { ArticleItem, ArticleMetadata, BadgeData } from '@tcitry/astro-book/presentation';
import type { ContentPage, TaxonomyTerm } from '../../lib/types';
import { breadcrumb, dateText, displayDate, excerpt } from './helpers';

export function articleBadges(page: ContentPage, tags: TaxonomyTerm[], detailed = false): BadgeData[] {
  const url = (name: string) => tags.find((tag) => tag.name === name)?.url || `/tags/${encodeURIComponent(name)}/`;
  const badges: BadgeData[] = [];
  if (detailed && (!page.title || !dateText(page.date) || !page.categories.length)) badges.push({ label: 'Draft', class: 'danger-title', trailingSpace: true, unstyled: true });
  if (page.type === 'docs') badges.push({ label: 'Doc', class: 'docs-title' });
  if (page.type === 'weekly') badges.push({ label: 'W', href: url('Weekly'), class: 'weekly-title' });
  if (page.type === 'links') badges.push({ label: 'L', href: '/links/', class: 'links-title' });
  if (page.tags.includes('Recommended')) badges.push({ label: 'R', href: url('Recommended'), class: 'recommended-title' });
  else if (page.tags.includes('ByAI')) badges.push({ label: 'ByAI', href: url('ByAI'), class: 'byAI-title' });
  if (detailed) for (const tag of page.tags.filter((name) => !['Weekly', 'Recommended', 'ByAI', 'Links'].includes(name))) badges.push({ label: tag, href: url(tag), class: 'tags-title', leadingSpace: true });
  return badges;
}

export function articleMetadata(page: ContentPage, tags: TaxonomyTerm[]): ArticleMetadata {
  return {
    date: dateText(page.date) ? { value: page.date, label: displayDate(page, 'localized') } : undefined,
    tags: page.tags.map((tag) => ({ label: tag, href: tags.find((term) => term.name === tag)?.url || `/tags/${encodeURIComponent(tag)}/` })),
    image: page.image ? { src: page.image, alt: page.title } : undefined,
  };
}

export function articleItem(page: ContentPage, tags: TaxonomyTerm[], options: { modified?: boolean; showSummary?: boolean; showBreadcrumb?: boolean; detailed?: boolean } = {}): ArticleItem {
  const { modified = false, showSummary = false, showBreadcrumb = true, detailed = true } = options;
  return {
    label: page.title,
    href: page.url,
    target: page.type === 'links' && page.redirect ? '_blank' : undefined,
    date: { value: modified ? page.lastmod : page.date, label: displayDate(page, 'short', modified ? 'lastmod' : 'date') },
    metadata: articleMetadata(page, tags),
    breadcrumb: showBreadcrumb ? breadcrumb(page) : undefined,
    summary: showSummary ? excerpt(page.summary) : undefined,
    badges: articleBadges(page, tags, detailed),
    prefix: detailed && (!page.title || !dateText(page.date) || !page.categories.length) ? page.source : undefined,
  };
}
