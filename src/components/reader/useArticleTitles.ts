import {useEffect, useState} from 'react';
import {articleTitleFallback, articleTitleKey, createArticleTitleLookup, preferredArticleTitle, type ArticleTitleItem} from '../../lib/article-titles';

const lookups = new Map<string, ReturnType<typeof createArticleTitleLookup>>();

function currentPage() {
  if (typeof document === 'undefined') return undefined;
  const comments = document.querySelector<HTMLElement>('[data-comment-pathname][data-comment-title]');
  if (comments?.dataset.commentPathname && comments.dataset.commentTitle) return {pathname: comments.dataset.commentPathname, title: comments.dataset.commentTitle};
  const widget = document.querySelector<HTMLElement>('[data-reader-pathname][data-reader-title]');
  return widget?.dataset.readerPathname && widget.dataset.readerTitle ? {pathname: widget.dataset.readerPathname, title: widget.dataset.readerTitle} : undefined;
}

export default function useArticleTitles(items: ArticleTitleItem[]) {
  const current = currentPage();
  const [titles, setTitles] = useState<ReadonlyMap<string, string> | undefined>();
  const needsLookup = items.some(item => !preferredArticleTitle(item, current));
  useEffect(() => {
    if (!needsLookup || titles) return;
    let active = true;
    let origin = window.location.origin;
    try {origin = new URL(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || window.location.href).origin;} catch { /* Fall back to the current public origin. */ }
    const lookup = lookups.get(origin) ?? createArticleTitleLookup(origin);
    lookups.set(origin, lookup);
    void lookup().then(value => {if (active) setTitles(value);});
    return () => {active = false;};
  }, [needsLookup, titles]);
  return (item: ArticleTitleItem) => preferredArticleTitle(item, current) || titles?.get(articleTitleKey(item.pathname)) || articleTitleFallback(item.pathname);
}
