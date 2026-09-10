import {createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode} from 'react';
import {getFunctionName} from 'convex/server';
import {ConvexError} from 'convex/values';
import {currentFixtureAuth, useAuth} from './reader-clerk';
import {fixtureUsername} from './services-clerk';

type Thread = { _id: string; owner: string; title: string; status: 'waiting' | 'replied' | 'closed'; createdAt: number; updatedAt: number };
type Message = { _id: string; threadId: string; sender: 'member' | 'author'; content: string; createdAt: number; imageIds?: string[] };
let revision = 1;
let configured = true;
let rejectNextMembership = false;
let rejectNextBookmark = false;
let heldAiSend: Promise<void> | undefined;
let releaseAiSend: (() => void) | undefined;
let pro = new Set(['fixture-a']);
let nextId = 1;
let now = Date.UTC(2026, 8, 9, 6);
const listeners = new Set<() => void>();
const threads: Thread[] = [];
const threadReadStates = new Map<string, 'pending' | 'error' | 'ready'>();
const bookmarks: {owner: string; pathname: string; title: string; updatedAt: number}[] = [];
const messages: Message[] = [];
const requests: {name: string; userId: string | null; args: Record<string, unknown>}[] = [];
const writes: {name: string; userId: string | null; args: Record<string, unknown>}[] = [];
const clients: {id: number; userId: string | null; sessionId: string | null; closed: boolean; closeCalls: number}[] = [];
const clientLifecycle: {clientId: number; event: 'setAuth' | 'clearAuth' | 'close'; closed: boolean}[] = [];
type Comment = {id: string; owner: string; pathname: string; authorName: string; body: string; createdAt: number; deleted: boolean; parentId?: string; imageIds: string[]};
type CommentImage = {id: string; owner: string; url: string; contentType: string; size: number; attached: boolean; purpose: 'comment' | 'consultation'; threadId?: string};
const commentPath = '/docs/services-fixture/';
const waitingCommentQueries = new Set<string>();
const initiallyWaiting = new URLSearchParams(location.search).get('waitingCommentQuery');
if (initiallyWaiting === 'summary') waitingCommentQueries.add('comments:getSummary');
if (initiallyWaiting === 'list') waitingCommentQueries.add('comments:list');
const comments: Comment[] = [{id: 'comment_initial', owner: 'fixture-reader', pathname: commentPath, authorName: '测试读者', body: '登录后可见的初始评论正文', createdAt: now, deleted: false, imageIds: []}];
const commentImages: CommentImage[] = [];
const articleLikes = new Map<string, Set<string>>();
const articleTitleOverrides = new Map<string, string | undefined>();
const commentLikes = new Map<string, Set<string>>();
const notifications: { _id: string; recipient: string; kind: 'comment_reply' | 'consultation_reply'; createdAt: number; readAt: number | null; target: null | {kind: 'comment'; pathname: string; commentId: string} | {kind: 'consultation'; threadId: string; messageId: string; title: string} }[] = [];
let rejectNextComment = false;
let rejectNextConsultation = false;
type Source = {id: string; title: string; url: string; sourceKind: 'author'};
type AiConversation = {id: string; owner: string; threadId: string; title: string; activeRun: string | null; updatedAt: number};
type AiMessage = {id: string; key: string; role: 'user' | 'assistant'; parts: {type: 'text'; text: string}[]; text: string; order: number; stepOrder: number; status: 'success' | 'streaming'; _creationTime: number; threadId: string};
type AiRun = {id: string; conversationId: string; order: number; status: 'running' | 'completed' | 'canceled'; sources: Source[]};
const sources: Source[] = [{id: '1', title: '已核验的 RAG 文章', url: 'https://yindongliang.com/docs/rag-fixture/', sourceKind: 'author'}];
const safeAnswer = '根据[已核验的文章](https://yindongliang.com/docs/rag-fixture/)回答。\n\n[外部链接](https://example.invalid/unsafe)与 ![图片替代文字](https://example.invalid/unsafe.png) 不应成为可操作链接或图片。';
const aiConversations: AiConversation[] = [
  {id: 'ai_a1', owner: 'fixture-a', threadId: 'agent_a1', title: '已保存的 RAG 问题', activeRun: null, updatedAt: now},
  {id: 'ai_a2', owner: 'fixture-a', threadId: 'agent_a2', title: '第二条已保存对话：关于 Cloudflare AI Search、Convex Agent 与 Clerk 会员服务的长标题记录', activeRun: null, updatedAt: now - 1},
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
    this.record = {id: clients.length + 1, ...currentFixtureAuth(), closed: false, closeCalls: 0};
    clients.push(this.record);
  }
  setAuth() {
    clientLifecycle.push({clientId: this.record.id, event: 'setAuth', closed: this.record.closed});
    if (this.record.closed) throw new Error('Services fixture: setAuth called after ConvexReactClient.close()');
  }
  clearAuth() {
    clientLifecycle.push({clientId: this.record.id, event: 'clearAuth', closed: this.record.closed});
    if (this.record.closed) throw new Error('Services fixture: clearAuth called after ConvexReactClient.close()');
  }
  async close() {
    this.record.closeCalls++;
    this.record.closed = true;
    clientLifecycle.push({clientId: this.record.id, event: 'close', closed: true});
  }
  async query(reference: Parameters<typeof getFunctionName>[0], args: Record<string, unknown> = {}) {
    const name = getFunctionName(reference);
    requests.push({name, userId: this.record.userId, args});
    return queryValue(this, name, args);
  }
}
const ClientContext = createContext<ConvexReactClient | null>(null);
function AuthFirstEffect({client, authContext}: {client: ConvexReactClient; authContext: string | null}) {
  useEffect(() => {if (authContext) client.setAuth();}, [client, authContext]);
  return null;
}
function AuthLastEffect({client, authContext}: {client: ConvexReactClient; authContext: string | null}) {
  useEffect(() => {
    if (authContext) return () => client.clearAuth();
  }, [client, authContext]);
  return null;
}
export function ConvexProviderWithClerk({client, children}: {client: ConvexReactClient; children: ReactNode}) {
  const {userId, sessionId} = useAuth();
  const authContext = userId ? `${userId}:${sessionId}` : null;
  // Match ConvexAuthState's first/last effect children: query subscribers clean
  // up before clearAuth, and the client must remain open throughout that cleanup.
  return <ClientContext.Provider value={client}>
    <AuthFirstEffect client={client} authContext={authContext} />
    {children}
    <AuthLastEffect client={client} authContext={authContext} />
  </ClientContext.Provider>;
}
export function useConvexAuth() { const {userId} = useAuth(); return {isAuthenticated: Boolean(userId), isLoading: false}; }
function useClient() {
  const client = useContext(ClientContext);
  if (!client) throw new Error('Services test: hook needs session-scoped Convex client');
  return client;
}
export const useConvex = useClient;
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
const publicImages = (imageIds: string[]) => commentImages.filter(image => imageIds.includes(image.id)).map(image => ({id: image.id, url: image.url, contentType: image.contentType, size: image.size}));
function bindConsultationImages(imageIds: string[], userId: string, threadId: string) {
  for (const imageId of imageIds) {
    const image = commentImages.find(item => item.id === imageId && item.owner === userId && item.purpose === 'consultation' && !item.attached);
    if (!image) throw new Error('Services fixture: invalid consultation image');
    image.attached = true; image.threadId = threadId;
  }
}

export function useQuery(reference: Parameters<typeof getFunctionName>[0], args: Record<string, unknown> | 'skip' = {}) {
  const client = useClient();
  const name = getFunctionName(reference);
  useSyncExternalStore(subscribe, () => revision);
  useEffect(() => {
    if (args !== 'skip') requests.push({name, userId: client.record.userId, args});
  }, [name, client, JSON.stringify(args)]);
  if (args === 'skip') return undefined;
  return queryValue(client, name, args);
}
function queryValue(client: ConvexReactClient, name: string, args: Record<string, unknown>) {
  const userId = client.record.userId;
  if (name === 'comments:getSummary') return waitingCommentQueries.has(name) ? undefined : {
    commentCount: comments.filter(comment => comment.pathname === args.pathname && !comment.deleted).length,
    likeCount: articleLikes.get(String(args.pathname))?.size ?? 0,
  };
  if (name === 'comments:getMyLike') {
    if (!userId) throw new Error('Services fixture: anonymous personal like query');
    return articleLikes.get(String(args.pathname))?.has(userId) ?? false;
  }
  if (name === 'notifications:hasUnread') {
    if (!userId) throw new Error('Services fixture: anonymous unread notifications');
    return notifications.some(notification => notification.recipient === userId && notification.readAt === null);
  }
  if (name === 'commentImages:getUrl') {
    if (!userId) throw new Error('Services fixture: anonymous image URL query');
    return commentImages.find(image => image.id === args.imageId && (image.owner === userId || image.attached))?.url ?? null;
  }
  if (name === 'membership:getConsultationRole') return {isAdmin: isAuthor(userId), ready: configured};
  if (name === 'consultations:getThread') {
    const thread = getThread(String(args.threadId), userId);
    const readState = threadReadStates.get(thread._id);
    if (readState === 'pending') return undefined;
    if (readState === 'error') throw new Error('Fixture consultation read failed');
    return publicThread(thread);
  }
  if (name === 'reader:getPage') {
    if (!userId) throw new Error('Services fixture: anonymous bookmark query');
    return {bookmarked: bookmarks.some(item => item.owner === userId && item.pathname === args.pathname)};
  }
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
  if (name === 'comments:list' && args !== 'skip' && waitingCommentQueries.has(name)) {
    if (!client.record.userId) throw new Error('Services fixture: anonymous comment body query');
    return {results: [], status: 'LoadingFirstPage', loadMore: () => {throw new Error('Cannot paginate a pending first page');}};
  }
  let rows: unknown[] = [];
  if (args !== 'skip') {
    const userId = client.record.userId;
    if (name === 'consultations:listThreads') rows = threads.filter(thread => thread.owner === userId).sort((a, b) => b.updatedAt - a.updatedAt).map(publicThread);
    else if (name === 'consultations:listInbox') {
      if (!isAuthor(userId)) throw new ConvexError({code: 'FORBIDDEN', message: '仅博主可以查看咨询收件箱。'});
      rows = [...threads].sort((a, b) => b.updatedAt - a.updatedAt).map(publicThread);
    }
    else if (name === 'consultations:listMessages') {
      getThread(String(args.threadId), userId);
      rows = messages.filter(message => message.threadId === args.threadId).sort((a, b) => b.createdAt - a.createdAt).map(({imageIds, ...message}) => ({...message, images: publicImages(imageIds ?? [])}));
    } else if (name === 'comments:list') {
      if (!userId) throw new Error('Services fixture: anonymous comment body query');
      rows = comments.filter(comment => comment.pathname === args.pathname).map(comment => {
        const parent = comments.find(item => item.id === comment.parentId);
        return {
          id: comment.id, authorName: comment.authorName, body: comment.deleted ? '' : comment.body,
          createdAt: comment.createdAt, deleted: comment.deleted, canDelete: comment.owner === userId || isAuthor(userId),
          likeCount: commentLikes.get(comment.id)?.size ?? 0, likedByMe: commentLikes.get(comment.id)?.has(userId) ?? false,
          images: publicImages(comment.imageIds),
          ...(parent ? {replyTo: {id: parent.id, authorName: parent.authorName, deleted: parent.deleted}} : {}),
        };
      });
    }
    else if (name === 'comments:listLikedArticles') {
      if (!userId) throw new Error('Services fixture: anonymous liked articles');
      rows = [...articleLikes].filter(([, likes]) => likes.has(userId)).map(([pathname]) => ({pathname, title: articleTitleOverrides.has(pathname) ? articleTitleOverrides.get(pathname) : pathname.includes('fixture-a') ? '账号 A 喜欢的文章' : pathname.includes('fixture-b') ? '账号 B 喜欢的文章' : '公开文章测试', createdAt: now}));
    }
    else if (name === 'comments:listMine') {
      if (!userId) throw new Error('Services fixture: anonymous personal comments');
      rows = comments.filter(comment => comment.owner === userId && !comment.deleted).map(comment => ({
        _id: comment.id, pathname: comment.pathname, body: comment.body, createdAt: comment.createdAt,
        ...(comment.parentId ? {parentId: comment.parentId} : {}), imageCount: comment.imageIds.length,
        articleTitle: articleTitleOverrides.has(comment.pathname) ? articleTitleOverrides.get(comment.pathname) : '公开文章测试',
      }));
    }
    else if (name === 'notifications:list') {
      if (!userId) throw new Error('Services fixture: anonymous notifications');
      rows = notifications.filter(notification => notification.recipient === userId).map(({recipient: _recipient, ...notification}) => notification).sort((a, b) => b.createdAt - a.createdAt);
    }
    else if (name === 'assistant:listConversations') rows = aiConversations.filter(item => item.owner === userId).sort((a, b) => b.updatedAt - a.updatedAt);
    else if (name === 'reader:listLibrary') {
      if (!userId) throw new Error('Services fixture: anonymous bookmark list');
      rows = bookmarks.filter(item => item.owner === userId).sort((a, b) => b.updatedAt - a.updatedAt).map(({owner: _owner, ...item}) => item);
    }
    else throw new Error(`Unsupported service fixture pagination ${name}`);
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
    if (name === 'reader:setBookmark') {
      if (rejectNextBookmark) {rejectNextBookmark = false; throw new Error('Fixture bookmark save failed');}
      const index = bookmarks.findIndex(item => item.owner === userId && item.pathname === args.pathname);
      if (args.bookmarked && index === -1) bookmarks.push({owner: userId, pathname: String(args.pathname), title: String(args.title), updatedAt: ++now});
      else if (!args.bookmarked && index !== -1) bookmarks.splice(index, 1);
      publish(); return Boolean(args.bookmarked);
    }
    if (name === 'membership:getMyMembership') {
      if (rejectNextMembership) {rejectNextMembership = false; throw new Error('Fixture membership request failed');}
      return {
        configured, isPro: configured && pro.has(userId), isAdmin: isAuthor(userId), consultationsReady: configured,
        validUntil: null,
      };
    }
    if (name === 'assistant:createConversation') {
      const id = `ai_${nextId++}`;
      aiConversations.push({id, owner: userId, threadId: `agent_${id}`, title: '新对话', activeRun: null, updatedAt: ++now});
      publish(); return id;
    }
    if (name === 'assistant:sendMessage') {
      const pending = heldAiSend; heldAiSend = undefined;
      if (pending) await pending;
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
      if (rejectNextConsultation) {rejectNextConsultation = false; throw new Error('Fixture consultation save failed');}
      const id = `thread_${nextId++}`;
      const imageIds = (args.imageIds ?? []) as string[];
      bindConsultationImages(imageIds, userId, id);
      threads.push({_id: id, owner: userId, title: String(args.title), status: 'waiting', createdAt: ++now, updatedAt: now});
      messages.push({_id: `message_${nextId++}`, threadId: id, sender: 'member', content: String(args.content), createdAt: now, imageIds});
      publish(); return id;
    }
    if (name === 'consultations:send') {
      const thread = getThread(String(args.threadId), userId);
      if (thread.owner !== userId) throw new ConvexError({code: 'FORBIDDEN', message: '只能向自己的咨询发送消息。'});
      if (!configured || !pro.has(userId)) throw new ConvexError({code: 'PRO_REQUIRED', message: '发送私人咨询需要有效的 Pro 会员。已有对话仍可查看。'});
      if (thread.status === 'closed') throw new ConvexError({code: 'CLOSED', message: '这条咨询已结束。'});
      if (rejectNextConsultation) {rejectNextConsultation = false; throw new Error('Fixture consultation save failed');}
      const id = `message_${nextId++}`;
      const imageIds = (args.imageIds ?? []) as string[];
      bindConsultationImages(imageIds, userId, thread._id);
      messages.push({_id: id, threadId: thread._id, sender: 'member', content: String(args.content), createdAt: ++now, imageIds});
      thread.status = 'waiting'; thread.updatedAt = now;
      publish(); return id;
    }
    if (name === 'consultations:reply') {
      if (!isAuthor(userId)) throw new ConvexError({code: 'FORBIDDEN', message: '仅博主可以回复咨询。'});
      const thread = getThread(String(args.threadId), userId);
      if (thread.status === 'closed') throw new ConvexError({code: 'CLOSED', message: '这条咨询已结束。'});
      if (rejectNextConsultation) {rejectNextConsultation = false; throw new Error('Fixture consultation save failed');}
      const id = `message_${nextId++}`;
      const imageIds = (args.imageIds ?? []) as string[];
      bindConsultationImages(imageIds, userId, thread._id);
      messages.push({_id: id, threadId: thread._id, sender: 'author', content: String(args.content), createdAt: ++now, imageIds});
      thread.status = 'replied'; thread.updatedAt = now;
      notifications.push({_id: `notification_${nextId++}`, recipient: thread.owner, kind: 'consultation_reply', createdAt: now, readAt: null,
        target: {kind: 'consultation', threadId: thread._id, messageId: id, title: thread.title}});
      publish(); return id;
    }
    if (name === 'consultations:close') {
      const thread = getThread(String(args.threadId), userId);
      thread.status = 'closed'; thread.updatedAt = ++now; publish(); return null;
    }
    if (name === 'comments:add') {
      if ('authorName' in args) throw new Error('Services fixture: clients must not submit comment author names');
      const authorName = fixtureUsername(userId);
      if (!authorName) throw new ConvexError({code: 'USERNAME_UNAVAILABLE', message: '当前登录信息缺少用户名，暂时无法发布评论。'});
      if (rejectNextComment) {rejectNextComment = false; throw new Error('Fixture comment save failed');}
      const id = `comment_${nextId++}`;
      const imageIds = (args.imageIds ?? []) as string[];
      for (const imageId of imageIds) {
        const image = commentImages.find(item => item.id === imageId && item.owner === userId && item.purpose === 'comment' && !item.attached);
        if (!image) throw new Error('Services fixture: invalid image attachment');
        image.attached = true;
      }
      comments.unshift({id, owner: userId, pathname: String(args.pathname), authorName, body: String(args.body), createdAt: ++now, deleted: false,
        ...(args.parentId ? {parentId: String(args.parentId)} : {}), imageIds});
      publish(); return id;
    }
    if (name === 'comments:setLike' || name === 'comments:setCommentLike') {
      const key = String(name === 'comments:setLike' ? args.pathname : args.commentId);
      const collection = name === 'comments:setLike' ? articleLikes : commentLikes;
      if (name === 'comments:setCommentLike' && !comments.some(comment => comment.id === key && comment.pathname === args.pathname && !comment.deleted)) {
        throw new Error('Services fixture: invalid comment like target');
      }
      const likes = collection.get(key) ?? new Set<string>();
      if (args.liked) likes.add(userId); else likes.delete(userId);
      collection.set(key, likes); publish(); return Boolean(args.liked);
    }
    if (name === 'commentImages:discard') {
      const index = commentImages.findIndex(image => image.id === args.imageId && image.owner === userId && !image.attached);
      if (index >= 0) commentImages.splice(index, 1);
      publish(); return null;
    }
    if (name === 'notifications:markRead') {
      const notification = notifications.find(item => item._id === args.id && item.recipient === userId);
      if (!notification) throw new Error('Services fixture: unauthorized notification');
      notification.readAt ??= ++now;
      await (window as unknown as {__recordNotificationRead?: (id: string) => Promise<void>}).__recordNotificationRead?.(notification._id);
      publish(); return null;
    }
    if (name === 'comments:remove') {
      const comment = comments.find(item => item.id === args.id);
      if (comment && comment.owner !== userId && !isAuthor(userId)) throw new Error('Services fixture: unauthorized comment removal');
      if (comment) {comment.deleted = true; comment.body = ''; comment.imageIds = [];}
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
  getState: () => ({clients, clientLifecycle, requests, writes, threads, messages, aiConversations, aiRuns, comments, commentImages, notifications, bookmarks}),
  markAllNotificationsRead: (recipient: string) => {
    for (const notification of notifications) {
      if (notification.recipient === recipient && notification.readAt === null) notification.readAt = ++now;
    }
    publish();
  },
  seedBookmarks: () => {
    bookmarks.push({owner: 'fixture-a', pathname: '/docs/another-bookmark-fixture/', title: '账号 A 收藏的另一篇文章', updatedAt: ++now});
    bookmarks.push({owner: 'fixture-b', pathname: commentPath, title: '账号 B 收藏的当前文章', updatedAt: ++now});
    publish();
  },
  seedConsultationStates: () => {
    for (const [id, status, title] of [
      ['state_closed', 'closed', '已结束咨询：状态确认前不展示回复输入框'],
      ['state_open', 'waiting', '可回复咨询：确认状态后开始输入'],
    ] as const) {
      threads.push({_id: id, owner: 'fixture-a', status, title, createdAt: ++now, updatedAt: now});
      messages.push({_id: `${id}_message`, threadId: id, sender: 'member', content: `${title}的已保存消息。`, createdAt: ++now});
      threadReadStates.set(id, 'pending');
    }
    publish();
  },
  setThreadReadState: (id: string, value: 'pending' | 'error' | 'ready') => {threadReadStates.set(id, value); publish();},
  waitForCommentQuery: (name: 'comments:getSummary' | 'comments:list', waiting: boolean) => {
    if (waiting) waitingCommentQueries.add(name); else waitingCommentQueries.delete(name);
    publish();
  },
  seedPersonal: () => {
    articleLikes.set('/docs/fixture-a-liked/', new Set(['fixture-a']));
    articleLikes.set('/docs/fixture-b-liked/', new Set(['fixture-b']));
    for (const userId of ['fixture-a', 'fixture-b']) comments.push({id: `personal-${userId}`, owner: userId, pathname: commentPath, authorName: fixtureUsername(userId)!, body: `${userId} 的个人评论内容`, createdAt: ++now, deleted: false, imageIds: userId === 'fixture-a' ? ['metadata-only-image'] : []});
    comments.push({id: 'deleted-personal', owner: 'fixture-a', pathname: commentPath, authorName: fixtureUsername('fixture-a')!, body: '已删除个人评论不得展示', createdAt: ++now, deleted: true, imageIds: []});
    notifications.push({_id: 'notification-comment', recipient: 'fixture-a', kind: 'comment_reply', createdAt: ++now, readAt: null, target: {kind: 'comment', pathname: commentPath, commentId: 'comment_initial'}});
    notifications.push({_id: 'notification-unavailable', recipient: 'fixture-a', kind: 'comment_reply', createdAt: ++now, readAt: null, target: null});
    publish();
  },
  seedLegacyTitles: () => {
    const legacyTitles: [string, string | undefined][] = [
      ['/docs/legacy-missing-title/', undefined],
      ['/docs/legacy-pathname-title/', '/docs/legacy-pathname-title/'],
      ['/docs/existing-title/', '已保存的文章标题'],
      ['/docs/%E0%A4%A/', undefined],
      ['/docs/metadata-missing-title/', undefined],
      ['/docs/%E6%B5%8B%E8%AF%95/', undefined],
    ];
    legacyTitles.forEach(([pathname, title], index) => {
      articleLikes.set(pathname, new Set(['fixture-a']));
      articleTitleOverrides.set(pathname, title);
      comments.push({id: `legacy-title-${index}`, owner: 'fixture-a', pathname, authorName: fixtureUsername('fixture-a')!, body: `旧记录评论 ${index + 1}`, createdAt: ++now, deleted: false, imageIds: []});
    });
    publish();
  },
  configure: (value: boolean) => {configured = value; publish();},
  failNextMembership: () => {rejectNextMembership = true;},
  failNextBookmark: () => {rejectNextBookmark = true;},
  holdNextAiSend: () => {heldAiSend = new Promise(resolve => {releaseAiSend = resolve;});},
  releaseAiSend: () => {releaseAiSend?.(); releaseAiSend = undefined;},
  failNextComment: () => {rejectNextComment = true;},
  failNextConsultation: () => {rejectNextConsultation = true;},
  canReadImage: (imageId: string) => {
    const {userId} = currentFixtureAuth();
    const image = commentImages.find(item => item.id === imageId);
    if (!userId || !image) return false;
    if (!image.attached) return image.owner === userId;
    if (image.purpose === 'comment') return true;
    return threads.some(thread => thread._id === image.threadId && (thread.owner === userId || isAuthor(userId)));
  },
  createImage: ({contentType, size, purpose = 'comment'}: {contentType: string; size: number; purpose?: 'comment' | 'consultation'}) => {
    const {userId} = currentFixtureAuth();
    if (!userId) throw new Error('Services fixture: anonymous upload');
    const id = `image_${nextId++}`;
    commentImages.push({id, owner: userId, url: `https://fixture.convex.site/comment-images/file?imageId=${id}`, contentType, size, attached: false, purpose});
    publish(); return id;
  },
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
