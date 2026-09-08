import type { ContentPage } from './types';

// These tags describe how an article is published, rather than its subject.
const editorialTags = new Set(['recommended', 'byai', 'weekly', 'links']);
const normalizeTopic = (tag: string) => tag.normalize('NFKC').trim().toLowerCase();
const topics = (page: ContentPage) => new Set(page.tags
  .map(normalizeTopic)
  .filter((tag) => tag && !editorialTags.has(tag)));
const eligible = (page: ContentPage) => page.kind === 'page' && page.type === 'posts'
  && !page.hidden && !page.redirect && page.params.draft !== true && page.params.draft !== 'true';
const timestamp = (page: ContentPage) => Date.parse(page.date) || 0;

/** Display the shared subjects using the current article's original labels. */
export function getSharedTopics(page: ContentPage, item: ContentPage): string[] {
  const subject = topics(page);
  const other = topics(item);
  const labels = new Map(page.tags.map((tag) => [normalizeTopic(tag), tag.trim()]));
  return [...subject].filter((tag) => other.has(tag)).map((tag) => labels.get(tag)!);
}

/** Build-time recommendations from the already filtered public content set. */
export function getRelatedPosts(page: ContentPage, allPages: ContentPage[]): ContentPage[] {
  if (!eligible(page)) return [];
  const subject = topics(page);
  if (!subject.size) return [];

  // The blog's categories are publication years, so they are not topic matches.
  const candidates = allPages
    .filter((item) => eligible(item) && item.id !== page.id && item.url !== page.url)
    .map((item) => ({ item, topics: topics(item) }));
  const topicPages = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const tag of candidate.topics) {
      if (!topicPages.has(tag)) topicPages.set(tag, new Set());
      topicPages.get(tag)!.add(candidate.item.url);
    }
  }
  const ranked = candidates
    .map(({ item, topics }) => {
      const shared = [...topics].filter((tag) => subject.has(tag));
      // Prefer a specific shared subject over a broad tag such as Life.
      const specificity = shared.reduce((sum, tag) => sum + 1 / topicPages.get(tag)!.size, 0);
      return { item, score: shared.length, specificity };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.specificity - a.specificity || timestamp(b.item) - timestamp(a.item)
      || a.item.title.localeCompare(b.item.title, 'zh-CN') || a.item.url.localeCompare(b.item.url));

  const seen = new Set<string>();
  return ranked.filter(({ item }) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 5).map(({ item }) => item);
}

/** Keep the footer link distinct from any existing Markdown heading. */
export function getRelatedPostsAnchor(page: ContentPage): string {
  const headings = new Set(page.headings.map(({ slug }) => slug));
  let anchor = 'related-posts';
  let suffix = 2;
  while (headings.has(anchor) || headings.has(`${anchor}-heading`)) anchor = `related-posts-${suffix++}`;
  return anchor;
}
