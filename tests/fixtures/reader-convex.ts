// Browser UI contract fixture only. This module is never imported by production code.
import {createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore} from 'react';
import {getFunctionName} from 'convex/server';
import {currentFixtureAuth, useAuth} from './reader-clerk';

type Bookmark = {pathname: string; title: string; updatedAt: number};
type ProgressRow = {pathname: string; title: string; progress: number; updatedAt: number; view: {progress: number}};
type Page = {bookmarked: boolean};
type Account = {page: Page; bookmarks: Bookmark[]; progress: ProgressRow[]};
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
  return {page: {bookmarked}, bookmarks, progress: []};
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
let snapshot = withInitialProgress(createAccount('测试'));
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
    if (name !== 'reader:setBookmark') throw new Error(`Unsupported fixture mutation: ${name}`);
    const bookmarked = Boolean(args.bookmarked);
    const bookmarks = current.bookmarks.filter((item) => item.pathname !== args.pathname);
    if (bookmarked) bookmarks.unshift({pathname: String(args.pathname), title: String(args.title), updatedAt: Date.now()});
    publish(client, {...current, page: {bookmarked}, bookmarks});
    return bookmarked;
  }, [client, name]);
}

export function usePaginatedQuery(reference: Parameters<typeof getFunctionName>[0], args: Record<string, never>, {initialNumItems}: {initialNumItems: number}) {
  const client = useContext(FixtureClientContext);
  const name = getFunctionName(reference);
  if (name !== 'reader:listLibrary' || Object.keys(args).length > 0) throw new Error('Only bookmark pagination is supported');
  const data = useSyncExternalStore(subscribe, () => account(client));
  const [limit, setLimit] = useState(initialNumItems);
  const [loading, setLoading] = useState(false);
  const userId = client?.record.userId ?? currentFixtureAuth().userId;
  useEffect(() => {listRequests.push({limit: initialNumItems, userId});}, [client, initialNumItems, userId]);
  return {
    results: data.bookmarks.slice(0, limit),
    status: loading ? 'LoadingMore' : limit >= data.bookmarks.length ? 'Exhausted' : 'CanLoadMore',
    loadMore(count: number) {
      listRequests.push({limit: limit + count, userId});
      setLoading(true);
      setTimeout(() => {setLimit((current) => current + count); setLoading(false);}, 30);
    },
  };
}

Object.assign(window, {__readerFixture: {
  getState: () => ({page: snapshot.page, writes, queries, listRequests, clients}),
  rejectNext: () => {rejectNext = true;},
  setConvexAuth: (value: {isAuthenticated: boolean; isLoading: boolean} | null) => {
    convexAuthOverride = value;
    listeners.forEach((listener) => listener());
  },
}});
