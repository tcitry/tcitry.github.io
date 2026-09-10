// Browser UI contract fixture only. This module is never imported by production code.
import {createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore} from 'react';
import {getFunctionName} from 'convex/server';
import {currentFixtureAuth, useAuth} from './reader-clerk';

type Bookmark = {pathname: string; title: string; updatedAt: number};
type Page = {bookmarked: boolean};
type Account = {page: Page; bookmarks: Bookmark[]};
const listeners = new Set<() => void>();
const writes: {name: string; args: Record<string, unknown>; userId: string | null}[] = [];
const queries: {name: string; userId: string | null}[] = [];
const listRequests: {limit: number; userId: string | null}[] = [];
let rejectNext = false;
const clients: {id: number; userId: string | null; sessionId: string | null; closed: boolean}[] = [];

function createAccount(owner: string, bookmarked = false): Account {
  const label = owner === '测试' ? owner : `${owner} `;
  const bookmarks = Array.from({length: bookmarked ? 22 : 23}, (_, index) => ({
    pathname: `/docs/fixture-${index + 1}/`,
    title: `${label}的收藏文章 ${index + 1}`,
    updatedAt: Date.UTC(2026, 8, 8) - index * 86_400_000,
  }));
  if (bookmarked) bookmarks.unshift({pathname: '/docs/fixture/', title: `${label}的已收藏文章`, updatedAt: Date.UTC(2026, 8, 9)});
  return {page: {bookmarked}, bookmarks};
}
let snapshot = createAccount('测试');
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
export function useConvexAuth() {const {userId} = useAuth(); return {isAuthenticated: Boolean(userId), isLoading: false};}
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

export function useQuery(reference: Parameters<typeof getFunctionName>[0]) {
  const client = useContext(FixtureClientContext);
  const name = getFunctionName(reference);
  if (name !== 'reader:getPage') throw new Error(`Unsupported fixture query: ${name}`);
  useEffect(() => {queries.push({name, userId: client?.record.userId ?? currentFixtureAuth().userId});}, [client, name]);
  return useSyncExternalStore(subscribe, () => account(client).page);
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
    if (name !== 'reader:setBookmark') throw new Error(`Unsupported fixture mutation: ${name}`);
    const current = account(client);
    const bookmarked = Boolean(args.bookmarked);
    const bookmarks = current.bookmarks.filter((item) => item.pathname !== args.pathname);
    if (bookmarked) bookmarks.unshift({pathname: String(args.pathname), title: String(args.title), updatedAt: Date.now()});
    publish(client, {page: {bookmarked}, bookmarks});
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
}});
