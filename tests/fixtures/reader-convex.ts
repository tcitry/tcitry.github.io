// Browser UI contract fixture only. This module is never imported by production code.
import {createContext, useCallback, useContext, useState, useSyncExternalStore} from 'react';
import {getFunctionName} from 'convex/server';
import {ConvexError} from 'convex/values';
import {currentFixtureAuth, useAuth} from './reader-clerk';

type Kind = 'bookmarks' | 'progress' | 'notes';
type Page = {bookmarked: boolean; progress: number | null; note: string; noteUpdatedAt: number | null};
let version = 1;
let snapshot: Page = {bookmarked: false, progress: 35, note: '云端初始笔记', noteUpdatedAt: 1};
const listeners = new Set<() => void>();
const writes: {name: string; args: Record<string, unknown>}[] = [];
const listRequests: {kind: Kind; limit: number}[] = [];
let rejectNext = false;
let recreateAfterClear: string | null = null;
const clients: {id: number; userId: string | null; sessionId: string | null; closed: boolean}[] = [];

export class ConvexReactClient {
  readonly record;
  readonly page: Page;
  constructor(_url: string) {
    this.record = {id: clients.length + 1, ...currentFixtureAuth(), closed: false};
    clients.push(this.record);
    this.page = {bookmarked: false, progress: null, note: this.record.userId === 'fixture-a' ? '账号 A 的私有笔记' : '账号 B 的私有笔记', noteUpdatedAt: 1};
  }
  async close() {this.record.closed = true;}
}
export const FixtureClientContext = createContext<ConvexReactClient | null>(null);
export function useConvexAuth() {const {userId} = useAuth(); return {isAuthenticated: Boolean(userId), isLoading: false};}

function publish(patch: Partial<Page>) {
  snapshot = {...snapshot, ...patch};
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {listeners.add(listener); return () => listeners.delete(listener);};

export function useQuery() {
  const client = useContext(FixtureClientContext);
  return useSyncExternalStore(subscribe, () => client?.page ?? snapshot);
}

export function useMutation(reference: Parameters<typeof getFunctionName>[0]) {
  const name = getFunctionName(reference);
  return useCallback(async (args: Record<string, unknown>) => {
    writes.push({name, args});
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (rejectNext) {rejectNext = false; throw new Error('Fixture request failure');}
    if (name === 'reader:setBookmark') {publish({bookmarked: Boolean(args.bookmarked)}); return snapshot.bookmarked;}
    if (name === 'reader:saveProgress') {publish({progress: Math.max(snapshot.progress ?? 0, Number(args.progress))}); return snapshot.progress;}
    if (name === 'reader:saveNote') {
      if (args.expectedUpdatedAt !== snapshot.noteUpdatedAt) throw new ConvexError({code: 'NOTE_CONFLICT'});
      const note = String(args.note).trim();
      publish({note, noteUpdatedAt: note ? ++version : null});
      const saved = {note, updatedAt: snapshot.noteUpdatedAt};
      if (!note && recreateAfterClear !== null) {
        const recreated = recreateAfterClear;
        recreateAfterClear = null;
        await new Promise((resolve) => setTimeout(resolve, 30));
        publish({note: recreated, noteUpdatedAt: ++version});
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return saved;
    }
    throw new Error(`Unsupported fixture mutation: ${name}`);
  }, [name]);
}

export function usePaginatedQuery(_reference: unknown, {kind}: {kind: Kind}, {initialNumItems}: {initialNumItems: number}) {
  const [limit, setLimit] = useState(initialNumItems);
  const [loading, setLoading] = useState(false);
  const items = Array.from({length: kind === 'notes' ? 3 : 23}, (_, index) => ({
    pathname: `/docs/fixture-${index + 1}/`,
    title: `${kind === 'notes' ? '笔记' : kind === 'progress' ? '阅读' : '收藏'}文章 ${index + 1}`,
    updatedAt: Date.UTC(2026, 8, 8) - index * 86_400_000,
    ...(kind === 'notes' ? {note: `私有测试笔记 ${index + 1}，仅由内存测试数据提供。`} : {}),
    ...(kind === 'progress' ? {progress: index === 0 ? 100 : 40} : {}),
  }));
  return {
    results: items.slice(0, limit),
    status: loading ? 'LoadingMore' : limit >= items.length ? 'Exhausted' : 'CanLoadMore',
    loadMore(count: number) {
      listRequests.push({kind, limit: limit + count});
      setLoading(true);
      setTimeout(() => {setLimit((current) => current + count); setLoading(false);}, 30);
    },
  };
}

Object.assign(window, {__readerFixture: {
  getState: () => ({page: snapshot, writes, listRequests, clients}),
  remoteNote: (note: string) => publish({note, noteUpdatedAt: note ? ++version : null}),
  remoteProgress: (progress: number) => publish({progress}),
  recreateAfterNextClear: (note: string) => {recreateAfterClear = note;},
  rejectNext: () => {rejectNext = true;},
}});
