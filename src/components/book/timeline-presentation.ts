import {parseFragment, type DefaultTreeAdapterMap} from 'parse5';

export type TimelineKind = 'pinned' | 'star' | 'x' | 'publish' | 'weekly' | 'repository' | 'media' | 'image' | 'code' | 'link' | 'note';

export interface TimelinePresentation {
  kind: TimelineKind;
  label: string;
  linkCount: number;
  weekday?: string;
  linksOnly?: true;
  /** Publish and weekly entries are hub nodes: the body keeps every related article link. */
  hub?: true;
  /** HTTP(S) links outside lists. Hubs only; this is the day's publish URL. */
  publishCount?: number;
  /** HTTP(S) links that appear only inside lists. Hubs only; these are related reading. */
  relatedCount?: number;
}

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

const labels: Record<TimelineKind, string> = {
  pinned: '置顶', star: 'GitHub Star', x: 'X 发布', publish: '站点发布', weekly: 'Weekly 发布',
  repository: '开源收录', media: '媒体', image: '图片', code: '代码', link: '链接收录', note: '随记',
};
const paragraphMarkers = new Map<string, 'star' | 'x' | 'publish' | 'weekly'>([
  ['⭐ Starred Github Repo', 'star'],
  ['🐦 Posted on X', 'x'],
  ['📝 Published on site', 'publish'],
  ['📰 Weekly published', 'weekly'],
]);
const ignored = new Set(['pre', 'code', 'script', 'style']);
const captionTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const githubSections = new Set([
  'about', 'account', 'apps', 'codespaces', 'collections', 'contact', 'copilot',
  'customer-stories', 'discussions', 'education', 'enterprise', 'events', 'explore',
  'features', 'issues', 'join', 'login', 'logout', 'marketplace', 'new',
  'notifications', 'org', 'orgs', 'organizations', 'pricing', 'projects', 'pulls',
  'readme', 'search', 'security', 'settings', 'signup', 'site', 'solutions',
  'sponsors', 'support', 'team', 'teams', 'topics', 'trending',
]);

function httpUrl(value: string | undefined): URL | undefined {
  if (!value || !/^https?:\/\//i.test(value.trim())) return;
  try {
    const url = new URL(value.trim());
    if (url.hostname && (url.protocol === 'https:' || url.protocol === 'http:')) return url;
  } catch { /* Malformed or relative links do not describe an external resource. */ }
}

function repositoryUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port ||
      url.username || url.password || url.search || url.hash) return false;
  const match = /^\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/([a-z0-9_.-]+)\/?$/i.exec(url.pathname);
  return Boolean(match && !githubSections.has(match[1].toLowerCase()) &&
    !/^\.{1,2}$/.test(match[2]) && !match[2].endsWith('.git'));
}

function xStatusUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  if (url.hostname !== 'x.com' && url.hostname !== 'www.x.com') return false;
  return /^\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status\/\d+(?:\/(?:photo|video)\/\d+)?\/?$/.test(url.pathname);
}

function youtubeUrl(url: URL): boolean {
  if (url.port || url.username || url.password) return false;
  if (url.hostname === 'youtu.be') return /^\/[a-z0-9_-]{11}\/?$/i.test(url.pathname);
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) return false;
  if (/^\/watch\/?$/.test(url.pathname)) return /^[a-z0-9_-]{11}$/i.test(url.searchParams.get('v') ?? '');
  if (/^\/playlist\/?$/.test(url.pathname)) return /^[a-z0-9_-]+$/i.test(url.searchParams.get('list') ?? '');
  return /^\/(?:shorts|live|embed)\/[a-z0-9_-]{11}\/?$/i.test(url.pathname) ||
    /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)(?:\/(?:videos|shorts|streams|playlists|featured))?\/?$/.test(url.pathname);
}

function text(node: Node): string {
  if ('tagName' in node && ignored.has(node.tagName)) return '';
  if ('value' in node) return node.value;
  return 'childNodes' in node ? node.childNodes.map(text).join('') : '';
}

function standaloneUrl(paragraph: Element): URL | undefined {
  const children = paragraph.childNodes.filter((node) =>
    node.nodeName !== '#comment' && !('value' in node && !node.value.trim()));
  if (children.length !== 1) return;
  const anchor = children[0];
  if (!('tagName' in anchor) || anchor.tagName !== 'a') return;
  const destination = httpUrl(anchor.attrs.find((attr) => attr.name === 'href')?.value);
  const visibleUrl = httpUrl(text(anchor));
  if (destination && visibleUrl && destination.href === visibleUrl.href) return destination;
}

function containsOnlyTextLinks(node: Node): boolean {
  if (node.nodeName === '#comment') return true;
  if ('value' in node) return !node.value.trim();
  if ('tagName' in node) {
    if (node.tagName === 'a') {
      return Boolean(httpUrl(node.attrs.find((attr) => attr.name === 'href')?.value)) &&
        node.childNodes.every((child) => child.nodeName === '#text' || child.nodeName === '#comment') &&
        Boolean(text(node).trim());
    }
    if (!['p', 'ul', 'ol', 'li', 'br'].includes(node.tagName)) return false;
  }
  return 'childNodes' in node && node.childNodes.every(containsOnlyTextLinks);
}

function listed(node: Node): boolean {
  let current: Node | undefined = node;
  while (current) {
    if ('tagName' in current && (current.tagName === 'ul' || current.tagName === 'ol')) return true;
    current = 'parentNode' in current ? current.parentNode ?? undefined : undefined;
  }
  return false;
}

/** Meta line for a hub. List links are related reading, not extra posts from the same day. */
export function hubLinkLabel(publishCount: number, relatedCount: number): string | undefined {
  if (publishCount > 0 && relatedCount > 0) return `${publishCount} 篇发布 · ${relatedCount} 条关联`;
  if (relatedCount > 0) return `${relatedCount} 条关联`;
  if (publishCount > 0) return `${publishCount} 篇发布`;
}

function normalizedCaption(node: Node): string {
  return text(node).replace(/\s+/g, ' ').trim().replace(/^#\s*/, '').replace(/\s*#$/, '');
}

function nextElementSibling(node: Node): Element | undefined {
  const parent = 'parentNode' in node ? node.parentNode : undefined;
  if (!parent || !('childNodes' in parent)) return;
  const siblings = parent.childNodes;
  const index = siblings.indexOf(node as (typeof siblings)[number]);
  if (index < 0) return;
  for (let cursor = index + 1; cursor < siblings.length; cursor++) {
    const sibling = siblings[cursor];
    if (sibling.nodeName === '#comment') continue;
    if ('value' in sibling && sibling.nodeName === '#text') {
      if (!sibling.value.trim()) continue;
      return;
    }
    if ('tagName' in sibling) return sibling;
    return;
  }
}

/**
 * Mark a 「关联阅读」 paragraph or heading that introduces the related list.
 * Only that start tag gains an attribute; every other byte stays as authored.
 */
export function markHubRelatedCaption(html: string): string {
  const fragment = parseFragment(html, {sourceCodeLocationInfo: true});
  const offsets: number[] = [];
  function visit(node: Node): void {
    if ('tagName' in node) {
      if (ignored.has(node.tagName)) return;
      const end = node.sourceCodeLocation?.startTag?.endOffset;
      const following = nextElementSibling(node);
      if (captionTags.has(node.tagName) && normalizedCaption(node) === '关联阅读' &&
          following && (following.tagName === 'ul' || following.tagName === 'ol') &&
          end != null && html[end - 1] === '>') offsets.push(end - 1);
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
  }
  visit(fragment);
  if (offsets.length === 0) return html;
  const attribute = ' data-timeline-related-caption=""';
  return offsets.sort((left, right) => right - left).reduce(
    (source, offset) => source.slice(0, offset) + attribute + source.slice(offset), html);
}

function weekday(label: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label) || label.startsWith('0000-')) return;
  const date = new Date(`${label}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== label) return;
  return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getUTCDay()];
}

/** Read authored HTML on the server. Classification does not rewrite or reorder it. */
export function getTimelinePresentation(item: {label: string; html: string}): TimelinePresentation {
  const links = new Map<string, URL>();
  const outsideLists = new Set<string>();
  const insideLists = new Set<string>();
  let star = false;
  let posted = false;
  let publish = false;
  let weekly = false;
  let repository = false;
  let media = false;
  let image = false;
  let code = false;

  function visit(node: Node): void {
    if ('tagName' in node) {
      if (node.tagName === 'pre') code = true;
      if (ignored.has(node.tagName)) return;
      if (['video', 'audio', 'iframe'].includes(node.tagName)) media = true;
      if (node.tagName === 'img') image = true;
      if (node.tagName === 'a') {
        const url = httpUrl(node.attrs.find((attr) => attr.name === 'href')?.value);
        if (url) {
          links.set(url.href, url);
          (listed(node) ? insideLists : outsideLists).add(url.href);
        }
      }
      if (node.tagName === 'p') {
        const marker = paragraphMarkers.get(text(node).replace(/\s+/g, ' ').trim());
        if (marker === 'star') star = true;
        else if (marker === 'x') posted = true;
        else if (marker === 'publish') publish = true;
        else if (marker === 'weekly') weekly = true;
        const url = standaloneUrl(node);
        if (url && repositoryUrl(url)) repository = true;
        if (url && youtubeUrl(url)) media = true;
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
  }

  const fragment = parseFragment(item.html);
  visit(fragment);
  const kind: TimelineKind = /^Top\s+\d{4}$/.test(item.label) ? 'pinned'
    : star && [...links.values()].some(repositoryUrl) ? 'star'
    : posted && [...links.values()].some(xStatusUrl) ? 'x'
    : publish ? 'publish'
    : weekly ? 'weekly'
    : media ? 'media' : image ? 'image' : code ? 'code' : repository ? 'repository'
    : links.size > 0 ? 'link' : 'note';
  const day = weekday(item.label);
  const linksOnly = kind !== 'pinned' && kind !== 'star' && kind !== 'x' && kind !== 'publish' && kind !== 'weekly'
    && links.size > 0 && containsOnlyTextLinks(fragment);
  const hub = kind === 'publish' || kind === 'weekly';
  let relatedCount = 0;
  if (hub) for (const href of insideLists) if (!outsideLists.has(href)) relatedCount += 1;
  return {
    kind, label: labels[kind], linkCount: links.size,
    ...(day ? {weekday: day} : {}), ...(linksOnly ? {linksOnly: true as const} : {}),
    ...(hub ? {hub: true as const, publishCount: outsideLists.size, relatedCount} : {}),
  };
}
