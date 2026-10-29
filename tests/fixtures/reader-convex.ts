// Browser UI contract fixture only. This module is never imported by production code.
import {createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore} from 'react';
import {getFunctionName} from 'convex/server';
import {currentFixtureAuth, useAuth} from './reader-clerk';

type Bookmark = {pathname: string; title: string; updatedAt: number};
type ProgressRow = {pathname: string; title: string; progress: number; updatedAt: number; view: {progress: number}};
type MarkRow = {pathname: string; title: string; status: 'later' | 'skimmed' | 'read' | 'studied'; updatedAt: number};
type TextAnnotationRow = {
  id: string; pathname: string; title: string; type: 'highlight' | 'note';
  quote: string; prefix: string; suffix: string; note: string | null; updatedAt: number;
};
type Page = {bookmarked: boolean};
type Account = {page: Page; bookmarks: Bookmark[]; progress: ProgressRow[]; marks: MarkRow[]; annotations: TextAnnotationRow[]};
const EMPTY_MARK = {status: null};
const EMPTY_PROGRESS = {progress: null as number | null};
const listeners = new Set<() => void>();
const writes: {name: string; args: Record<string, unknown>; userId: string | null}[] = [];
const queries: {name: string; userId: string | null}[] = [];
const listRequests: {limit: number; userId: string | null}[] = [];
let rejectNext = false;
let convexAuthOverride: {isAuthenticated: boolean; isLoading: boolean} | null = null;
const clients: {id: number; userId: string | null; sessionId: string | null; closed: boolean}[] = [];

function createAccount(owner: string, bookmarked = false): Account {
  const label = owner === '测试' ? owner : `${owner} `;
  const bookmarks = Array.from({length: bookmarked ? 22 : 23}, (_, index) => ({
    pathname: `/docs/fixture-${index + 1}/`,
    title: `${label}的收藏文章 ${index + 1}`,
    updatedAt: Date.UTC(2026, 8, 8) - index * 86_400_000,
  }));
  if (bookmarked) bookmarks.unshift({pathname: '/docs/fixture/', title: `${label}的已收藏文章`, updatedAt: Date.UTC(2026, 8, 9)});
  return {page: {bookmarked}, bookmarks, progress: [], marks: [], annotations: []};
}
function withInitialProgress(account: Account): Account {
  const raw = new URLSearchParams(location.search).get('progress');
  if (raw === null) return account;
  const progress = Number(raw);
  if (!Number.isFinite(progress)) return account;
  const clamped = Math.min(1, Math.max(0, progress));
  return {...account, progress: [{
    pathname: '/docs/fixture/', title: '公开测试文章', progress: clamped, updatedAt: Date.UTC(2026, 8, 9), view: {progress: clamped},
  }]};
}
function withReadingList(account: Account): Account {
  if (new URLSearchParams(location.search).get('readingList') !== '1') return account;
  const pathname = '/docs/Cloudflare/cloudflare-os-product-and-workers-architecture/';
  const title = 'Cloudflare OS：产品形态、Gadgets、Gatekeepers 与 Workers 架构';
  const day = Date.UTC(2026, 9, 21, 12);
  return {
    ...account,
    marks: [
      {pathname, title, status: 'later', updatedAt: day},
      {pathname: '/docs/mark-only/', title: '只有阅读标记的文章', status: 'read', updatedAt: day - 86_400_000},
    ],
  };
}
let snapshot = withReadingList(withInitialProgress(createAccount('测试')));
const accounts = new Map([
  ['fixture-a', createAccount('账号 A', true)],
  ['fixture-b', createAccount('账号 B')],
]);

export class ConvexReactClient {
  readonly record;
  constructor(_url: string) {
    this.record = {id: clients.length + 1, ...currentFixtureAuth(), closed: false};
    clients.push(this.record);
  }
  async close() {this.record.closed = true;}
}
export const FixtureClientContext = createContext<ConvexReactClient | null>(null);
export function useConvexAuth() {
  const override = useSyncExternalStore(subscribe, () => convexAuthOverride);
  const {userId} = useAuth();
  if (override) return override;
  return {isAuthenticated: Boolean(userId), isLoading: false};
}
const subscribe = (listener: () => void) => {listeners.add(listener); return () => listeners.delete(listener);};
function account(client: ConvexReactClient | null) {
  if (!client) return snapshot;
  const data = accounts.get(client.record.userId ?? '');
  if (!data) throw new Error('Unauthenticated fixture query');
  return data;
}
function publish(client: ConvexReactClient | null, next: Account) {
  if (client) accounts.set(client.record.userId!, next);
  else snapshot = next;
  listeners.forEach((listener) => listener());
}

export function useQuery(reference: Parameters<typeof getFunctionName>[0], args?: Record<string, unknown> | 'skip') {
  const client = useContext(FixtureClientContext);
  const name = getFunctionName(reference);
  const skipped = args === 'skip';
  const pathname = !skipped && args ? String(args.pathname ?? '') : '';
  useEffect(() => {
    if (skipped) return;
    queries.push({name, userId: client?.record.userId ?? currentFixtureAuth().userId});
  }, [client, name, pathname, skipped]);
  return useSyncExternalStore(subscribe, () => {
    if (skipped) return undefined;
    const data = account(client);
    if (name === 'reader:getPage') return data.page;
    if (name === 'reader:getReadingMark') return EMPTY_MARK;
    if (name === 'reader:getReadingProgress') {
      return data.progress.find(item => item.pathname === pathname)?.view ?? EMPTY_PROGRESS;
    }
    throw new Error(`Unsupported fixture query: ${name}`);
  });
}

export function useMutation(reference: Parameters<typeof getFunctionName>[0]) {
  const client = useContext(FixtureClientContext);
  const name = getFunctionName(reference);
  return useCallback(async (args: Record<string, unknown>) => {
    const userId = client?.record.userId ?? currentFixtureAuth().userId;
    if (!userId) throw new Error('Unauthenticated fixture mutation');
    writes.push({name, args, userId});
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (rejectNext) {rejectNext = false; throw new Error('Fixture request failure');}
    const current = account(client);
    if (name === 'reader:setReadingProgress') {
      const progress = Math.min(1, Math.max(0, Number(args.progress)));
      if (!Number.isFinite(progress)) throw new Error('Invalid progress');
      const existing = current.progress.find(item => item.pathname === args.pathname);
      if (existing && progress <= existing.progress) return existing.progress;
      const view = {progress};
      const row = {pathname: String(args.pathname), title: String(args.title), progress, updatedAt: Date.now(), view};
      const progressRows = existing
        ? current.progress.map(item => item.pathname === row.pathname ? row : item)
        : [row, ...current.progress];
      publish(client, {...current, progress: progressRows});
      return progress;
    }
    if (name === 'reader:setReadingMark' || name === 'reader:clearReadingMark') return args.status ?? null;
    if (name === 'reader:createTextAnnotation') {
      const row: TextAnnotationRow = {
        id: `ann-${(current.annotations?.length ?? 0) + 1}`,
        pathname: String(args.pathname), title: String(args.title),
        type: args.type as TextAnnotationRow['type'], quote: String(args.quote),
        prefix: String(args.prefix ?? ''), suffix: String(args.suffix ?? ''),
        note: typeof args.note === 'string' ? args.note : null, updatedAt: Date.now(),
      };
      publish(client, {...current, annotations: [row, ...(current.annotations ?? [])]});
      return row.id;
    }
    if (name === 'reader:deleteTextAnnotation') {
      publish(client, {...current, annotations: (current.annotations ?? []).filter(item => item.id !== args.id)});
      return null;
    }
    if (name !== 'reader:setBookmark') throw new Error(`Unsupported fixture mutation: ${name}`);
    const bookmarked = Boolean(args.bookmarked);
    const bookmarks = current.bookmarks.filter((item) => item.pathname !== args.pathname);
    if (bookmarked) bookmarks.unshift({pathname: String(args.pathname), title: String(args.title), updatedAt: Date.now()});
    publish(client, {...current, page: {bookmarked}, bookmarks});
    return bookmarked;
  }, [client, name]);
}

export function usePaginatedQuery(reference: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>, {initialNumItems}: {initialNumItems: number}) {
  const client = useContext(FixtureClientContext);
  const name = getFunctionName(reference);
  const data = useSyncExternalStore(subscribe, () => account(client));
  const [limit, setLimit] = useState(initialNumItems);
  const [loading, setLoading] = useState(false);
  const userId = client?.record.userId ?? currentFixtureAuth().userId;
  const argsKey = JSON.stringify(args ?? {});
  useEffect(() => {listRequests.push({limit: initialNumItems, userId});}, [client, initialNumItems, userId, name, argsKey]);
  useEffect(() => {setLimit(initialNumItems);}, [argsKey, name, initialNumItems]);
  const page = <T,>(rows: T[]) => ({
    results: rows.slice(0, limit),
    status: loading ? 'LoadingMore' as const : limit >= rows.length ? 'Exhausted' as const : 'CanLoadMore' as const,
    loadMore(count: number) {
      listRequests.push({limit: limit + count, userId});
      setLoading(true);
      setTimeout(() => {setLimit(current => current + count); setLoading(false);}, 30);
    },
  });
  if (name === 'reader:listLibrary') {
    if (Object.keys(args).length > 0) throw new Error('Only bookmark pagination is supported');
    return page(data.bookmarks);
  }
  if (name === 'reader:listReadingMarks') {
    const status = typeof args.status === 'string' ? args.status : undefined;
    const rows = data.marks.filter(item => !status || item.status === status).sort((a, b) => b.updatedAt - a.updatedAt);
    return page(rows);
  }
  if (name === 'reader:listTextAnnotations') {
    const type = typeof args.type === 'string' ? args.type : undefined;
    const rows = (data.annotations ?? []).filter(item => !type || item.type === type).sort((a, b) => b.updatedAt - a.updatedAt);
    return page(rows);
  }
  throw new Error(`Unsupported fixture pagination: ${name}`);
}

Object.assign(window, {__readerFixture: {
  getState: () => ({page: snapshot.page, writes, queries, listRequests, clients}),
  rejectNext: () => {rejectNext = true;},
  setConvexAuth: (value: {isAuthenticated: boolean; isLoading: boolean} | null) => {
    convexAuthOverride = value;
    listeners.forEach((listener) => listener());
  },
  setTextAnnotations: (rows: TextAnnotationRow[]) => {
    snapshot = {...snapshot, annotations: rows};
    listeners.forEach((listener) => listener());
  },
}});
