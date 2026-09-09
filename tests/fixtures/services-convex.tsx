import {createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode} from 'react';
import {getFunctionName} from 'convex/server';
import {ConvexError} from 'convex/values';
import {currentFixtureAuth, useAuth} from './reader-clerk';

type Thread = { _id: string; owner: string; title: string; status: 'waiting' | 'replied' | 'closed'; createdAt: number; updatedAt: number };
type Message = { _id: string; threadId: string; sender: 'member' | 'author'; content: string; createdAt: number };
let revision = 1;
let configured = true;
let pro = new Set(['fixture-a']);
let nextId = 1;
let now = Date.UTC(2026, 8, 9, 6);
const listeners = new Set<() => void>();
const threads: Thread[] = [];
const messages: Message[] = [];
const requests: {name: string; userId: string | null; args: Record<string, unknown>}[] = [];
const writes: {name: string; userId: string | null; args: Record<string, unknown>}[] = [];
const clients: {id: number; userId: string | null; sessionId: string | null; closed: boolean}[] = [];
const comments = [{id: 'comment_initial', authorName: '测试读者', body: '登录后可见的初始评论正文', createdAt: now, canDelete: false}];
type Source = {id: string; title: string; url: string; sourceKind: 'author'};
type AiConversation = {id: string; owner: string; threadId: string; title: string; activeRun: string | null; updatedAt: number};
type AiMessage = {id: string; key: string; role: 'user' | 'assistant'; parts: {type: 'text'; text: string}[]; text: string; order: number; stepOrder: number; status: 'success' | 'streaming'; _creationTime: number; threadId: string};
type AiRun = {id: string; conversationId: string; order: number; status: 'running' | 'completed' | 'canceled'; sources: Source[]};
const sources: Source[] = [{id: '1', title: '已核验的 RAG 文章', url: 'https://yindongliang.com/docs/rag-fixture/', sourceKind: 'author'}];
const safeAnswer = '根据[已核验的文章](https://yindongliang.com/docs/rag-fixture/)回答。\n\n[外部链接](https://example.invalid/unsafe)与 ![图片替代文字](https://example.invalid/unsafe.png) 不应成为可操作链接或图片。';
const aiConversations: AiConversation[] = [
  {id: 'ai_a1', owner: 'fixture-a', threadId: 'agent_a1', title: '已保存的 RAG 问题', activeRun: null, updatedAt: now},
  {id: 'ai_a2', owner: 'fixture-a', threadId: 'agent_a2', title: '第二条已保存对话', activeRun: null, updatedAt: now - 1},
  {id: 'ai_b1', owner: 'fixture-b', threadId: 'agent_b1', title: '账号 B 的 AI 记录', activeRun: null, updatedAt: now},
];
const aiMessages: AiMessage[] = [];
const aiRuns: AiRun[] = [];
function addAiMessage(threadId: string, order: number, role: AiMessage['role'], text: string, status: AiMessage['status'] = 'success') {
  const id = `aimessage_${nextId++}`;
  aiMessages.push({id, key: id, role, parts: [{type: 'text', text}], text, order, stepOrder: role === 'user' ? 0 : 1, status, _creationTime: ++now, threadId});
}
for (const conversation of aiConversations) {
  addAiMessage(conversation.threadId, 0, 'user', conversation.title);
  addAiMessage(conversation.threadId, 0, 'assistant', conversation.id === 'ai_a1' ? safeAnswer : conversation.id === 'ai_a2' ? '另一条历史回答。' : '仅账号 B 的历史回答。');
  aiRuns.push({id: `run_${conversation.id}`, conversationId: conversation.id, order: 0, status: 'completed', sources});
}
const subscribe = (listener: () => void) => {listeners.add(listener); return () => listeners.delete(listener);};
const publish = () => {revision++; listeners.forEach(listener => listener());};

export class ConvexReactClient {
  readonly record;
  constructor(_url: string) {
    this.record = {id: clients.length + 1, ...currentFixtureAuth(), closed: false};
    clients.push(this.record);
  }
  async close() { this.record.closed = true; }
}
const ClientContext = createContext<ConvexReactClient | null>(null);
export function ConvexProviderWithClerk({client, children}: {client: ConvexReactClient; children: ReactNode}) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}
export function useConvexAuth() { const {userId} = useAuth(); return {isAuthenticated: Boolean(userId), isLoading: false}; }
function useClient() {
  const client = useContext(ClientContext);
  if (!client) throw new Error('Services test: hook needs session-scoped Convex client');
  return client;
}
const isAuthor = (userId: string | null) => userId === 'fixture-author';
function getThread(threadId: string, userId: string | null) {
  const thread = threads.find(thread => thread._id === threadId && (thread.owner === userId || isAuthor(userId)));
  if (!thread) throw new ConvexError({code: 'NOT_FOUND', message: '无权查看该咨询。'});
  return thread;
}
function getAiConversation(conversationId: string, userId: string | null) {
  const conversation = aiConversations.find(item => item.id === conversationId && item.owner === userId);
  if (!conversation) throw new ConvexError({code: 'NOT_FOUND', message: '无权查看该 AI 对话。'});
  return conversation;
}
const publicThread = ({owner: _owner, ...thread}: Thread) => thread;

export function useQuery(reference: Parameters<typeof getFunctionName>[0], args: Record<string, unknown> | 'skip' = {}) {
  const client = useClient();
  const name = getFunctionName(reference);
  useSyncExternalStore(subscribe, () => revision);
  useEffect(() => {
    if (args !== 'skip') requests.push({name, userId: client.record.userId, args});
  }, [name, client, JSON.stringify(args)]);
  if (args === 'skip') return undefined;
  const userId = client.record.userId;
  if (name === 'membership:getConsultationRole') return {isAdmin: isAuthor(userId), ready: configured};
  if (name === 'consultations:getThread') return publicThread(getThread(String(args.threadId), userId));
  if (name === 'reader:getPage') return {bookmarked: false, progress: null, note: '', noteUpdatedAt: null};
  if (name === 'assistant:getRunStates') {
    getAiConversation(String(args.conversationId), userId);
    return aiRuns.filter(run => run.conversationId === args.conversationId && (args.orders as number[]).includes(run.order));
  }
  if (name === 'assistant:getConversation') return getAiConversation(String(args.conversationId), userId);
  throw new Error(`Unsupported service fixture query ${name}`);
}

export function usePaginatedQuery(reference: Parameters<typeof getFunctionName>[0], args: Record<string, unknown> | 'skip', {initialNumItems}: {initialNumItems: number}) {
  const client = useClient();
  const name = getFunctionName(reference);
  const [limit, setLimit] = useState(initialNumItems);
  useSyncExternalStore(subscribe, () => revision);
  useEffect(() => {
    if (args !== 'skip') requests.push({name, userId: client.record.userId, args});
  }, [name, client, JSON.stringify(args), limit]);
  let rows: unknown[] = [];
  if (args !== 'skip') {
    const userId = client.record.userId;
    if (name === 'consultations:listThreads') rows = threads.filter(thread => thread.owner === userId || isAuthor(userId)).sort((a, b) => b.updatedAt - a.updatedAt).map(publicThread);
    else if (name === 'consultations:listMessages') {
      getThread(String(args.threadId), userId);
      rows = messages.filter(message => message.threadId === args.threadId).sort((a, b) => b.createdAt - a.createdAt);
    } else if (name === 'comments:list') rows = comments;
    else if (name === 'assistant:listConversations') rows = aiConversations.filter(item => item.owner === userId).sort((a, b) => b.updatedAt - a.updatedAt);
    else if (name !== 'reader:listLibrary') throw new Error(`Unsupported service fixture pagination ${name}`);
  }
  return {results: rows.slice(0, limit), status: rows.length > limit ? 'CanLoadMore' : 'Exhausted', loadMore: (count: number) => setLimit(current => current + count)};
}

function useRequest(reference: Parameters<typeof getFunctionName>[0]) {
  const client = useClient();
  const name = getFunctionName(reference);
  return useCallback(async (args: Record<string, unknown> = {}) => {
    const userId = client.record.userId;
    writes.push({name, userId, args});
    if (!userId) throw new ConvexError({code: 'UNAUTHENTICATED', message: '请先登录。'});
    if (name === 'membership:getMyMembership') return {
      configured, isPro: configured && pro.has(userId), isAdmin: isAuthor(userId), consultationsReady: configured,
      validUntil: configured && pro.has(userId) ? Date.UTC(2026, 9, 9) : null,
    };
    if (name === 'assistant:createConversation') {
      const id = `ai_${nextId++}`;
      aiConversations.push({id, owner: userId, threadId: `agent_${id}`, title: '新对话', activeRun: null, updatedAt: ++now});
      publish(); return id;
    }
    if (name === 'assistant:sendMessage') {
      const conversation = getAiConversation(String(args.conversationId), userId);
      const runId = `run_${nextId++}`;
      const order = aiRuns.filter(run => run.conversationId === conversation.id).length;
      aiRuns.push({id: runId, conversationId: conversation.id, order, status: 'running', sources});
      conversation.activeRun = runId; conversation.title = String(args.prompt); conversation.updatedAt = ++now;
      addAiMessage(conversation.threadId, order, 'user', String(args.prompt));
      addAiMessage(conversation.threadId, order, 'assistant', '正在生成的部分回答。', 'streaming');
      publish(); return runId;
    }
    if (name === 'assistant:cancel') {
      const conversation = getAiConversation(String(args.conversationId), userId);
      const run = aiRuns.find(run => run.id === conversation.activeRun);
      if (run) {
        run.status = 'canceled';
        for (const message of aiMessages.filter(item => item.threadId === conversation.threadId && item.order === run.order)) message.status = 'success';
      }
      conversation.activeRun = null; publish(); return null;
    }
    if (name === 'consultations:start') {
      if (!configured || !pro.has(userId)) throw new ConvexError({code: 'PRO_REQUIRED', message: '发送私人咨询需要有效的 Pro 会员。已有对话仍可查看。'});
      const id = `thread_${nextId++}`;
      threads.push({_id: id, owner: userId, title: String(args.title), status: 'waiting', createdAt: ++now, updatedAt: now});
      messages.push({_id: `message_${nextId++}`, threadId: id, sender: 'member', content: String(args.content), createdAt: now});
      publish(); return id;
    }
    if (name === 'consultations:send') {
      const thread = getThread(String(args.threadId), userId);
      if (!isAuthor(userId) && !pro.has(userId)) throw new ConvexError({code: 'PRO_REQUIRED', message: '发送私人咨询需要有效的 Pro 会员。已有对话仍可查看。'});
      const id = `message_${nextId++}`;
      messages.push({_id: id, threadId: thread._id, sender: isAuthor(userId) ? 'author' : 'member', content: String(args.content), createdAt: ++now});
      thread.status = isAuthor(userId) ? 'replied' : 'waiting'; thread.updatedAt = now;
      publish(); return id;
    }
    if (name === 'consultations:close') {
      const thread = getThread(String(args.threadId), userId);
      thread.status = 'closed'; thread.updatedAt = ++now; publish(); return null;
    }
    if (name === 'comments:add') {
      const id = `comment_${nextId++}`;
      comments.unshift({id, authorName: String(args.authorName), body: String(args.body), createdAt: ++now, canDelete: true});
      publish(); return id;
    }
    if (name === 'comments:remove') {
      const index = comments.findIndex(comment => comment.id === args.id);
      if (index >= 0) comments.splice(index, 1);
      publish(); return null;
    }
    throw new Error(`Unsupported services fixture write ${name}`);
  }, [client, name]);
}
export const useAction = useRequest;
export const useMutation = useRequest;

export function useUIMessages(_reference: unknown, {threadId}: {threadId: string}, {initialNumItems}: {initialNumItems: number}) {
  const client = useClient();
  const [limit, setLimit] = useState(initialNumItems);
  useSyncExternalStore(subscribe, () => revision);
  const conversation = aiConversations.find(item => item.threadId === threadId && item.owner === client.record.userId);
  if (!conversation) throw new Error('Services fixture: unauthorized agent thread');
  const rows = aiMessages.filter(message => message.threadId === threadId);
  return {results: rows.slice(-limit), status: rows.length > limit ? 'CanLoadMore' : 'Exhausted', loadMore: (count: number) => setLimit(current => current + count)};
}

Object.assign(window, {__services: {
  getState: () => ({clients, requests, writes, threads, messages, aiConversations, aiRuns}),
  configure: (value: boolean) => {configured = value; publish();},
  setPro: (userId: string, value: boolean) => {value ? pro.add(userId) : pro.delete(userId); publish();},
  completeAi: () => {
    for (const conversation of aiConversations) {
      const run = aiRuns.find(run => run.id === conversation.activeRun);
      if (!run) continue;
      run.status = 'completed'; conversation.activeRun = null;
      const message = aiMessages.find(item => item.threadId === conversation.threadId && item.order === run.order && item.role === 'assistant');
      if (message) { message.status = 'success'; message.text = safeAnswer; message.parts = [{type: 'text', text: safeAnswer}]; }
    }
    publish();
  },
}});
