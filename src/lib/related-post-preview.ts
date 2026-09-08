import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type { ContentPage } from './types';
import { bookTitle, displayDate } from '../components/book/helpers';
import { getSharedTopics } from './related-posts';

type Node = DefaultTreeAdapterMap['node'];
const excluded = new Set(['pre', 'script', 'style', 'svg', 'math', 'table', 'figure', 'figcaption', 'nav', 'aside', 'button', 'summary', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const disclosure = /^(?:AI\s*(?:参与|辅助|生成|使用)说明|AI[- ]assisted (?:editing|content) disclosure|This article is extracted from the chat log with AI|说明[:：]\s*本文由\s*(?:Codex|ChatGPT|AI)\b.*(?:辅助生成|AI\s*生成|整理内容|非作者原创)|\d{4}-\d{2}-\d{2}\s*修订[（(]Agent[:：])/i;
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
const normalized = (text: string) => clean(text).normalize('NFKC').toLowerCase();

function omitted(node: Node): boolean {
  if (!('tagName' in node)) return false;
  const attrs = new Map(node.attrs.map(({ name, value }) => [name, value]));
  return excluded.has(node.tagName) || attrs.has('hidden') || attrs.get('aria-hidden') === 'true'
    || attrs.has('data-footnotes') || attrs.has('data-pagefind-ignore')
    || /(?:^|\s)(?:mermaid|katex)(?:\s|$)/.test(attrs.get('class') || '');
}

function textOf(node: Node): string {
  if (omitted(node)) return '';
  if ('value' in node) return node.value;
  if ('tagName' in node && node.tagName === 'br') return ' ';
  return 'childNodes' in node ? node.childNodes.map(textOf).join('') : '';
}

function paragraphs(node: Node): string[] {
  if (omitted(node)) return [];
  if ('tagName' in node && node.tagName === 'p') return [clean(textOf(node))];
  const prose = 'childNodes' in node ? node.childNodes.flatMap(paragraphs) : [];
  if ('tagName' in node) {
    const isNote = node.tagName === 'blockquote'
      || node.attrs.some(({ name, value }) => name === 'class' && /(?:^|\s)book-hint(?:\s|$)/.test(value));
    // A disclosure can include follow-up revision paragraphs within the same note.
    if (isNote && disclosure.test(prose.find(Boolean) || '')) return [];
  }
  return prose;
}

function shorten(text: string): string {
  const characters = [...text];
  return characters.length > 120 ? characters.slice(0, 120).join('').trimEnd() + '…' : text;
}

/** Select prose, not the flattened summary that may contain code or diagram text. */
export function getRelatedPostDescription(page: ContentPage): string {
  const suitable = (text: string) => text && normalized(text) !== normalized(bookTitle(page)) && !disclosure.test(text);
  const description = clean(textOf(parseFragment(page.description)));
  if (suitable(description)) return shorten(description);
  const prose = paragraphs(parseFragment(page.html)).find((text) => [...text].length >= 24 && suitable(text));
  return prose ? shorten(prose) : '';
}

export function getRelatedPostPreview(item: ContentPage, current: ContentPage) {
  return {
    href: item.url,
    title: bookTitle(item).trim(),
    description: getRelatedPostDescription(item),
    date: item.date,
    dateLabel: displayDate(item),
    topics: getSharedTopics(current, item).slice(0, 2),
  };
}

export type RelatedPostPreview = ReturnType<typeof getRelatedPostPreview>;
