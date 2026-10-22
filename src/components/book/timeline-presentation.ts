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

function weekday(label: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label) || label.startsWith('0000-')) return;
  const date = new Date(`${label}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== label) return;
  return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getUTCDay()];
}

/** Read authored HTML on the server; presentation never rewrites or reorders it. */
export function getTimelinePresentation(item: {label: string; html: string}): TimelinePresentation {
  const links = new Map<string, URL>();
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
        if (url) links.set(url.href, url);
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
  return {
    kind, label: labels[kind], linkCount: links.size,
    ...(day ? {weekday: day} : {}), ...(linksOnly ? {linksOnly: true as const} : {}),
    ...(hub ? {hub: true as const} : {}),
  };
}
