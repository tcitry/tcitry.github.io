import {Agent, abortStream, createThread, createTool, listStreams, listUIMessages, saveMessage, syncStreams, vStreamArgs} from '@convex-dev/agent';
import {RateLimiter} from '@convex-dev/rate-limiter';
import {jsonSchema, stepCountIs} from 'ai';
import {paginationOptsValidator, type PaginationOptions} from 'convex/server';
import {ConvexError, type GenericId, v} from 'convex/values';
import {components, internal} from './_generated/api';
import type {Doc, Id} from './_generated/dataModel';
import {env, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx} from './_generated/server';
import {toolInstructions, workersAiChatModel, NO_SOURCES, SAFE_ERROR, TOOL_BUDGET, type GenerationEvent, type Snippet, type Source} from './assistantModel';
import {searchRetrievalOptions} from './assistantRetrievalConfig';
import {retrievePublicSources} from './assistantPublicSearch';

const sourceValidator = v.object({id: v.string(), title: v.string(), url: v.string(), sourceKind: v.union(v.literal('author'), v.literal('ai-assisted'))});
const phaseValidator = v.union(v.literal('thinking'), v.literal('searching'), v.literal('writing'));
const DEFAULT_CHAT_MODEL = '@cf/zai-org/glm-5.3';
const DEFAULT_CHAT_GATEWAY = 'tcitry-blog-chat';
const TOOL_QUERY_MAX = 200;
const TOOL_SNIPPET_BUDGET = 14_000;
const TOOL_TIMEOUT_MS = 6_000;
const TOOL_TOTAL_TIMEOUT_MS = 12_000;
const TOOL_REASONING_EFFORT = 'low';

function extractTopicTerms(messages: {role: string; content: string}[]) {
  const text = messages.map(message => message.content).join(' ');
  const terms = new Set<string>();
  // Code/identifiers inside backticks.
  for (const match of text.matchAll(/`([^`\s]{2,80})`/g)) terms.add(match[1]);
  // Path-like or camel/kebab identifiers.
  for (const match of text.matchAll(/(?:[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+|[A-Z][a-zA-Z0-9]+[A-Z][a-zA-Z0-9]+|[A-Z0-9]{2,}|[a-zA-Z][a-zA-Z0-9_-]{2,})/g)) {
    const term = match[0];
    if (/^(a|an|the|is|are|was|were|be|been|this|that|these|those|and|or|but|of|to|in|on|at|for|with|as|it|its|from|by)$/i.test(term)) continue;
    terms.add(term);
  }
  return [...terms].slice(0, 12).join(' ').slice(0, 200);
}
const limiter = new RateLimiter(components.rateLimiter, {
  assistantQuestions: {kind: 'token bucket', rate: 12, period: 60_000, capacity: 4},
  assistantThreads: {kind: 'token bucket', rate: 6, period: 60_000, capacity: 3},
});
const active = (run: Doc<'assistantRuns'>) => run.status === 'queued' || run.status === 'running';

async function owner(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({code: 'UNAUTHENTICATED', message: '请先登录。'});
  return identity.tokenIdentifier;
}

async function ownedConversation(ctx: QueryCtx | MutationCtx, id: Id<'assistantConversations'>) {
  const identity = await owner(ctx);
  const conversation = await ctx.db.get('assistantConversations', id);
  if (!conversation || conversation.owner !== identity) throw new ConvexError({code: 'NOT_FOUND', message: '对话不存在或无权访问。'});
  return conversation;
}

function boundedPagination(options: PaginationOptions) {
  if (!Number.isInteger(options.numItems) || options.numItems < 1 || options.numItems > 50
      || (options.maximumRowsRead !== undefined && (!Number.isInteger(options.maximumRowsRead) || options.maximumRowsRead < 1 || options.maximumRowsRead > 100))
      || (options.maximumBytesRead !== undefined && (!Number.isInteger(options.maximumBytesRead) || options.maximumBytesRead < 1 || options.maximumBytesRead > 1_000_000))) {
    throw new ConvexError({code: 'INVALID_ARGUMENT', message: '分页范围无效。'});
  }
}

export const createConversation = mutation({
  args: {},
  returns: v.id('assistantConversations'),
  handler: async (ctx) => {
    const identity = await owner(ctx);
    await limiter.limit(ctx, 'assistantThreads', {key: identity, throws: true});
    const threadId = await createThread(ctx, components.agent, {userId: identity, title: '新对话'});
    const now = Date.now();
    return ctx.db.insert('assistantConversations', {owner: identity, threadId, title: '新对话', createdAt: now, updatedAt: now});
  },
});

export const listConversations = query({
  args: {paginationOpts: paginationOptsValidator},
  handler: async (ctx, {paginationOpts}) => {
    const identity = await owner(ctx);
    boundedPagination(paginationOpts);
    const result = await ctx.db.query('assistantConversations').withIndex('by_owner_and_updatedAt', q => q.eq('owner', identity)).order('desc').paginate(paginationOpts);
    return {...result, page: result.page.map(item => ({id: item._id, title: item.title, updatedAt: item.updatedAt}))};
  },
});

export const getConversation = query({
  args: {conversationId: v.id('assistantConversations')},
  handler: async (ctx, {conversationId}) => {
    const conversation = await ownedConversation(ctx, conversationId);
    const run = conversation.activeRunId ? await ctx.db.get('assistantRuns', conversation.activeRunId) : null;
    return {id: conversation._id, title: conversation.title, threadId: conversation.threadId,
      activeRun: run && active(run) ? {id: run._id, status: run.status, promptOrder: run.promptOrder} : null};
  },
});

export const sendMessage = mutation({
  args: {conversationId: v.id('assistantConversations'), prompt: v.string(), requestId: v.string()},
  returns: v.id('assistantRuns'),
  handler: async (ctx, args) => {
    const conversation = await ownedConversation(ctx, args.conversationId);
    const prompt = args.prompt.trim();
    if (!prompt || args.prompt.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt)
        || !/^[a-zA-Z0-9_-]{16,100}$/.test(args.requestId)) throw new ConvexError({code: 'INVALID_ARGUMENT', message: '问题须为 1–2000 字。'});
    const previous = await ctx.db.query('assistantRuns').withIndex('by_conversationId_and_requestId', q => q.eq('conversationId', conversation._id).eq('requestId', args.requestId)).unique();
    if (previous) {
      const saved = await ctx.runQuery(components.agent.messages.getMessagesByIds, {messageIds: [previous.promptMessageId]});
      if (saved[0]?.message?.content !== prompt) throw new ConvexError({code: 'REQUEST_CONFLICT', message: '发送标识已用于其他问题，请重新发送。'});
      return previous._id;
    }
    if (conversation.activeRunId) {
      const running = await ctx.db.get('assistantRuns', conversation.activeRunId);
      if (running && active(running)) throw new ConvexError({code: 'BUSY', message: '当前回答仍在进行，可以等待或停止生成。'});
    }
    await limiter.limit(ctx, 'assistantQuestions', {key: conversation.owner, throws: true});
    const saved = await saveMessage(ctx, components.agent, {threadId: conversation.threadId, userId: conversation.owner, prompt});
    const now = Date.now();
    const runId = await ctx.db.insert('assistantRuns', {conversationId: conversation._id, owner: conversation.owner,
      requestId: args.requestId, promptMessageId: saved.messageId, promptOrder: saved.message.order,
      status: 'queued', sources: [], createdAt: now, deadlineAt: now + 120_000});
    await ctx.db.patch('assistantConversations', conversation._id, {activeRunId: runId, updatedAt: now,
      ...(conversation.title === '新对话' ? {title: prompt.replace(/\s+/g, ' ').slice(0, 80)} : {})});
    // Message, run and both jobs commit together. A disconnected browser cannot
    // undo an acknowledged submission, and a lost provider response has a deadline.
    await ctx.scheduler.runAfter(0, internal.assistant.generate, {runId});
    await ctx.scheduler.runAfter(120_000, internal.assistant.expire, {runId});
    return runId;
  },
});

export const listThreadMessages = query({
  args: {threadId: v.string(), paginationOpts: paginationOptsValidator, streamArgs: vStreamArgs},
  handler: async (ctx, args) => {
    const identity = await owner(ctx);
    const conversation = await ctx.db.query('assistantConversations').withIndex('by_threadId', q => q.eq('threadId', args.threadId)).unique();
    if (!conversation || conversation.owner !== identity) throw new ConvexError({code: 'NOT_FOUND', message: '对话不存在或无权访问。'});
    if (!(args.streamArgs && args.paginationOpts.numItems === 0)) boundedPagination(args.paginationOpts);
    if (args.streamArgs?.kind === 'deltas') {
      if (args.streamArgs.cursors.length > 50 || args.streamArgs.cursors.some(cursor => !Number.isSafeInteger(cursor.cursor) || cursor.cursor < 0)) throw new ConvexError({code: 'INVALID_ARGUMENT', message: '消息范围无效。'});
      // Component 0.7.2 listDeltas does not enforce its threadId argument. Never
      // pass a caller's cursor until its stream has been scoped to this thread.
      const allowed = new Set((await listStreams(ctx, components.agent, {threadId: args.threadId, includeStatuses: ['streaming', 'finished', 'aborted']})).map(stream => stream.streamId));
      if (args.streamArgs.cursors.some(cursor => !allowed.has(cursor.streamId))) throw new ConvexError({code: 'NOT_FOUND', message: '消息流不存在或无权访问。'});
    } else if (args.streamArgs?.startOrder !== undefined && (!Number.isSafeInteger(args.streamArgs.startOrder) || args.streamArgs.startOrder < 0)) {
      throw new ConvexError({code: 'INVALID_ARGUMENT', message: '消息范围无效。'});
    }
    const page = args.paginationOpts.numItems === 0 ? {page: [], isDone: true, continueCursor: ''} : await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);
    return {...page, page: page.page.map(message => ({id: message.id, key: message.key, role: message.role,
      parts: message.parts.filter(part => part.type === 'text'), text: message.text,
      order: message.order, stepOrder: message.stepOrder, status: message.status, _creationTime: message._creationTime})),
      streams: streams?.kind === 'list' ? {...streams, messages: streams.messages.map(({userId: _user, providerOptions: _options, ...message}) => message)} : streams};
  },
});

export const getRunStates = query({
  args: {conversationId: v.id('assistantConversations'), orders: v.array(v.number())},
  handler: async (ctx, {conversationId, orders}) => {
    await ownedConversation(ctx, conversationId);
    if (orders.length > 50 || orders.some(order => !Number.isSafeInteger(order) || order < 0)) throw new ConvexError({code: 'INVALID_ARGUMENT', message: '消息范围无效。'});
    const runs = await Promise.all([...new Set(orders)].map(order => ctx.db.query('assistantRuns')
      .withIndex('by_conversationId_and_promptOrder', q => q.eq('conversationId', conversationId).eq('promptOrder', order)).unique()));
    return runs.filter(run => run !== null).map(run => ({order: run.promptOrder, status: run.status, sources: run.sources, error: run.error ?? null,
      phase: run.phase ?? null, toolCalls: run.toolCalls ?? 0}));
  },
});

async function settle(ctx: MutationCtx, run: Doc<'assistantRuns'>, status: 'completed' | 'failed' | 'canceled', error?: string) {
  if (!active(run)) return;
  const conversation = await ctx.db.get('assistantConversations', run.conversationId);
  if (!conversation) return;
  if (status !== 'completed') await abortStream(ctx, components.agent, {threadId: conversation.threadId, order: run.promptOrder, reason: status === 'canceled' ? '已停止生成。' : SAFE_ERROR});
  await ctx.db.patch('assistantRuns', run._id, {status, completedAt: Date.now(), ...(error ? {error} : {})});
  if (conversation.activeRunId === run._id) await ctx.db.patch('assistantConversations', conversation._id, {activeRunId: undefined, updatedAt: Date.now()});
}

export const cancel = mutation({
  args: {conversationId: v.id('assistantConversations')}, returns: v.null(),
  handler: async (ctx, {conversationId}) => {
    const conversation = await ownedConversation(ctx, conversationId);
    const run = conversation.activeRunId ? await ctx.db.get('assistantRuns', conversation.activeRunId) : null;
    if (run) await settle(ctx, run, 'canceled');
    return null;
  },
});

export const deleteConversation = mutation({
  args: {conversationId: v.id('assistantConversations')}, returns: v.null(),
  handler: async (ctx, {conversationId}) => {
    const conversation = await ownedConversation(ctx, conversationId);
    const run = conversation.activeRunId ? await ctx.db.get('assistantRuns', conversation.activeRunId) : null;
    if (run) await settle(ctx, run, 'canceled');
    let cursor: string | null = null;
    while (true) {
      const batch = await ctx.db.query('assistantRuns')
        .withIndex('by_conversationId_and_createdAt', q => q.eq('conversationId', conversationId))
        .paginate({cursor, numItems: 100});
      for (const item of batch.page) await ctx.db.delete('assistantRuns', item._id);
      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }
    const threadId = conversation.threadId;
    await ctx.db.delete('assistantConversations', conversationId);
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {threadId: threadId as GenericId<'threads'>});
    return null;
  },
});

export const expire = internalMutation({
  args: {runId: v.id('assistantRuns')}, returns: v.null(),
  handler: async (ctx, {runId}) => {
    const run = await ctx.db.get('assistantRuns', runId);
    if (run && active(run) && run.deadlineAt <= Date.now()) await settle(ctx, run, 'failed', '回答已超时，请重新提问。');
    return null;
  },
});

export const start = internalMutation({
  args: {runId: v.id('assistantRuns')},
  handler: async (ctx, {runId}) => {
    const run = await ctx.db.get('assistantRuns', runId);
    if (!run || run.status !== 'queued') return null;
    if (run.deadlineAt <= Date.now()) { await settle(ctx, run, 'failed', '回答已超时，请重新提问。'); return null; }
    const conversation = await ctx.db.get('assistantConversations', run.conversationId);
    if (!conversation || conversation.activeRunId !== runId) return null;
    await ctx.db.patch('assistantRuns', runId, {status: 'running', phase: 'thinking', toolCalls: 0});
    return {threadId: conversation.threadId, promptMessageId: run.promptMessageId, promptOrder: run.promptOrder, deadlineAt: run.deadlineAt};
  },
});

export const setPhase = internalMutation({
  args: {runId: v.id('assistantRuns'), phase: phaseValidator, toolCalls: v.optional(v.number())}, returns: v.boolean(),
  handler: async (ctx, {runId, phase, toolCalls}) => {
    const run = await ctx.db.get('assistantRuns', runId);
    if (!run || run.status !== 'running') return false;
    if (toolCalls !== undefined && (!Number.isInteger(toolCalls) || toolCalls < 0 || toolCalls > TOOL_BUDGET.maxToolCalls)) throw new Error(SAFE_ERROR);
    await ctx.db.patch('assistantRuns', runId, {phase, ...(toolCalls !== undefined ? {toolCalls} : {})});
    return true;
  },
});

export const isActive = internalQuery({
  args: {runId: v.id('assistantRuns')}, returns: v.boolean(),
  handler: async (ctx, {runId}) => {
    const run = await ctx.db.get('assistantRuns', runId);
    return run?.status === 'running';
  },
});

function completedText(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() ? content : null;
  if (!Array.isArray(content) || !content.length || content.some(part => !part || typeof part !== 'object'
      || part.type !== 'text' || typeof part.text !== 'string')) return null;
  const text = content.map(part => part.text).join('');
  return text.trim() ? text : null;
}

// Failed/canceled attempts remain in the transcript but must not displace the
// last successful topic or contribute partial answers to the next model call.
export const completedContext = internalQuery({
  args: {runId: v.id('assistantRuns')},
  returns: v.union(v.null(), v.object({previousQuestion: v.union(v.string(), v.null()),
    messages: v.array(v.object({role: v.union(v.literal('user'), v.literal('assistant')), content: v.string()}))})),
  handler: async (ctx, {runId}) => {
    const run = await ctx.db.get('assistantRuns', runId);
    if (!run || run.status !== 'running') return null;
    const conversation = await ctx.db.get('assistantConversations', run.conversationId);
    if (!conversation || conversation.activeRunId !== runId) return null;
    if (conversation.owner !== run.owner) throw new Error(SAFE_ERROR);
    const recent = await ctx.db.query('assistantRuns').withIndex('by_conversationId_and_promptOrder', q =>
      q.eq('conversationId', run.conversationId).lt('promptOrder', run.promptOrder)).order('desc').take(32);
    const candidates = recent.filter(candidate => candidate.status === 'completed' && candidate.owner === run.owner).slice(0, 4);
    const pairs: {question: string; answer: string}[] = [];
    for (const candidate of candidates) {
      const response = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
        threadId: conversation.threadId, upToAndIncludingMessageId: candidate.promptMessageId,
        statuses: ['success'], excludeToolMessages: true, order: 'desc', paginationOpts: {cursor: null, numItems: 10},
      });
      const round = response.page.filter(message => message.threadId === conversation.threadId
        && message.order === candidate.promptOrder && message.status === 'success');
      const prompt = round.find(message => message._id === candidate.promptMessageId && message.message?.role === 'user');
      // A tool-loop round stores one assistant message per step under the same
      // order; the visible answer is the last text-only step.
      const answers = round.filter(message => message.message?.role === 'assistant' && prompt && message.stepOrder > prompt.stepOrder
        && completedText(message.message?.content) !== null).sort((a, b) => b.stepOrder - a.stepOrder);
      if (!prompt || !answers.length) continue;
      const question = completedText(prompt.message?.content);
      const answer = completedText(answers[0].message?.content);
      if (!question || !answer || question.length > 2000 || answer.length > 12_000) continue;
      pairs.push({question, answer});
    }
    const previousQuestion = pairs[0]?.question ?? null;
    return {previousQuestion, messages: pairs.reverse().flatMap(({question, answer}) => [
      {role: 'user' as const, content: question}, {role: 'assistant' as const, content: answer},
    ])};
  },
});

export const setSources = internalMutation({
  args: {runId: v.id('assistantRuns'), sources: v.array(sourceValidator)}, returns: v.boolean(),
  handler: async (ctx, {runId, sources}) => {
    const run = await ctx.db.get('assistantRuns', runId);
    if (!run || run.status !== 'running') return false;
    if (sources.length > 5) throw new Error(SAFE_ERROR);
    await ctx.db.patch('assistantRuns', runId, {sources, phase: 'writing'});
    return true;
  },
});

export const finish = internalMutation({
  args: {runId: v.id('assistantRuns'), failed: v.boolean(), noSources: v.optional(v.boolean())}, returns: v.null(),
  handler: async (ctx, {runId, failed, noSources}) => {
    const run = await ctx.db.get('assistantRuns', runId);
    if (!run || run.status !== 'running') return null;
    const conversation = await ctx.db.get('assistantConversations', run.conversationId);
    if (!conversation) return null;
    if (noSources && !failed) await saveMessage(ctx, components.agent, {threadId: conversation.threadId,
      promptMessageId: run.promptMessageId, message: {role: 'assistant', content: NO_SOURCES}, agentName: '博客助手'});
    await settle(ctx, run, failed ? 'failed' : 'completed', failed ? SAFE_ERROR : undefined);
    return null;
  },
});

export const generate = internalAction({
  args: {runId: v.id('assistantRuns')}, returns: v.null(),
  handler: async (ctx, {runId}) => {
    const run: {threadId: string; promptMessageId: string; promptOrder: number; deadlineAt: number} | null = await ctx.runMutation(internal.assistant.start, {runId});
    if (!run) return null;
    const startedAt = Date.now();
    const trace = (event: {stage: string} & Partial<Omit<GenerationEvent, 'stage'>>) => {
      // Fixed stages, elapsed time, status/error codes and protocol field names. Never pass an
      // exception, prompt, URL, source text, tool query or account identifier to the logger.
      console.info('assistant_generation', {...event, elapsedMs: Date.now() - startedAt});
    };
    let failure: Promise<void> | undefined;
    const fail = () => failure ??= (async () => {
      trace({stage: 'failed'});
      try { await ctx.runMutation(internal.assistant.finish, {runId, failed: true}); }
      catch { trace({stage: 'settle_failed'}); throw new Error(SAFE_ERROR); }
    })();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(SAFE_ERROR)), Math.max(1, run.deadlineAt - Date.now() - 1000));
    const assertActive = async () => {
      controller.signal.throwIfAborted();
      if (!await ctx.runQuery(internal.assistant.isActive, {runId})) { controller.abort(new Error('已停止生成。')); throw new Error('已停止生成。'); }
    };
    try {
      if (!env.AI_SEARCH_PUBLIC_URL) throw new Error(SAFE_ERROR);
      await assertActive();
      const prompts = await ctx.runQuery(components.agent.messages.getMessagesByIds, {messageIds: [run.promptMessageId]});
      const prompt = prompts[0]?.message;
      if (!prompt || prompt.role !== 'user' || typeof prompt.content !== 'string') throw new Error(SAFE_ERROR);
      const context = await ctx.runQuery(internal.assistant.completedContext, {runId});
      if (!context) return null;
      const topicTerms = extractTopicTerms(context.messages);
      await generateWithTool(ctx, {runId, run, history: context.messages, topicTerms, controller, assertActive, trace, fail});
    } catch {
      await fail();
    } finally { clearTimeout(timeout); }
    return null;
  },
});

type ToolRunArgs = {
  runId: Id<'assistantRuns'>;
  run: {threadId: string; promptMessageId: string};
  history: {role: 'user' | 'assistant'; content: string}[];
  topicTerms: string;
  controller: AbortController;
  assertActive: () => Promise<void>;
  trace: (event: {stage: string} & Partial<Omit<GenerationEvent, 'stage'>>) => void;
  fail: () => Promise<void>;
};

export function validateToolQuery(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const query = input.trim();
  // eslint-disable-next-line no-control-regex
  if (!query || query.length > TOOL_QUERY_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(query)) return null;
  return query;
}

// Sources are shared across tool calls: stable numbering, URL-level dedupe, at most
// five entries. Snippets share one character budget so a second call cannot blow the prompt.
export function mergeToolSources(state: {sources: Source[]; snippets: Snippet[]; budgetLeft: number},
    retrieved: {sources: Source[]; snippets: Snippet[]}) {
  const byUrl = new Map(state.sources.map(source => [source.url, source.id]));
  const remap = new Map<string, string>();
  for (const source of retrieved.sources) {
    const existing = byUrl.get(source.url);
    if (existing) { remap.set(source.id, existing); continue; }
    if (state.sources.length >= 5) continue;
    const id = String(state.sources.length + 1);
    state.sources.push({...source, id});
    byUrl.set(source.url, id);
    remap.set(source.id, id);
  }
  const added: Snippet[] = [];
  for (const snippet of retrieved.snippets) {
    const id = remap.get(snippet.source);
    if (!id) continue;
    if (state.snippets.some(existing => existing.source === id && existing.text === snippet.text)) continue;
    const text = snippet.text.slice(0, Math.max(0, state.budgetLeft));
    if (!text) break;
    state.budgetLeft -= text.length;
    const merged = {...snippet, source: id, text};
    state.snippets.push(merged);
    added.push(merged);
  }
  return added;
}

async function generateWithTool(ctx: ActionCtx, {runId, run, history, topicTerms, controller, assertActive, trace, fail}: ToolRunArgs) {
  const searchUrl = env.AI_SEARCH_PUBLIC_URL;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  if (!searchUrl || !accountId || !apiToken) { trace({stage: 'tool_mode_unconfigured'}); throw new Error(SAFE_ERROR); }
  const state = {sources: [] as Source[], snippets: [] as Snippet[], budgetLeft: TOOL_SNIPPET_BUDGET, toolCalls: 0, toolMs: 0};
  const shortQuery = (query: string) => query.length < 6 || /^(它|这个|那个|这|那|上面|前面|刚才|this|that|it)/i.test(query);
  const searchBlog = createTool({
    description: '检索本站已发布的博客文章与文档。输入检索词（不超过 200 字符），返回编号后的相关片段；回答时用「来源 N」引用编号。',
    inputSchema: jsonSchema<{query: string}>({type: 'object', properties: {query: {type: 'string', description: '检索词，不超过 200 字符'}},
      required: ['query'], additionalProperties: false}),
    execute: async (_toolCtx, input) => {
      state.toolCalls += 1;
      trace({stage: 'tool_call', toolCalls: state.toolCalls});
      if (state.toolCalls > TOOL_BUDGET.maxToolCalls) { trace({stage: 'tool_budget_exceeded'}); throw new Error(SAFE_ERROR); }
      await assertActive();
      await ctx.runMutation(internal.assistant.setPhase, {runId, phase: 'searching', toolCalls: state.toolCalls});
      let query = validateToolQuery(input.query);
      if (!query) { trace({stage: 'tool_query_invalid'}); return {ok: false as const, reason: 'invalid_query' as const}; }
      if (shortQuery(query) && topicTerms) {
        query = `${topicTerms} ${query}`.slice(0, TOOL_QUERY_MAX);
        trace({stage: 'tool_query_augmented', queryLength: query.length});
      }
      const remaining = Math.min(TOOL_TIMEOUT_MS, TOOL_TOTAL_TIMEOUT_MS - state.toolMs);
      if (remaining <= 0) { trace({stage: 'tool_unavailable'}); return {ok: false as const, reason: 'unavailable' as const}; }
      const toolController = new AbortController();
      const onAbort = () => toolController.abort(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, {once: true});
      const timer = setTimeout(() => toolController.abort(new Error(SAFE_ERROR)), remaining);
      const startedAt = Date.now();
      try {
        const retrieved = await retrievePublicSources(searchUrl, query, toolController.signal,
          {observe: trace, fallback: false, retrievalOptions: searchRetrievalOptions({queryRewrite: false})});
        const added = mergeToolSources(state, retrieved);
        await assertActive();
        if (!await ctx.runMutation(internal.assistant.setSources, {runId, sources: state.sources})) throw new Error(SAFE_ERROR);
        trace({stage: 'tool_result', sourceCount: state.sources.length, toolCalls: state.toolCalls});
        return {ok: true as const, results: added.map(snippet => ({source: Number(snippet.source), title: snippet.title, sourceKind: snippet.sourceKind,
          updatedAt: snippet.updatedAt, text: snippet.text}))};
      } catch (error) {
        if (controller.signal.aborted) throw error;
        trace({stage: 'tool_unavailable'});
        return {ok: false as const, reason: 'unavailable' as const};
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        state.toolMs += Date.now() - startedAt;
        if (!controller.signal.aborted) await ctx.runMutation(internal.assistant.setPhase, {runId, phase: 'writing', toolCalls: state.toolCalls}).catch(() => {});
      }
    },
  });
  const model = workersAiChatModel({accountId, apiToken, gateway: env.ASSISTANT_CHAT_GATEWAY?.trim() || DEFAULT_CHAT_GATEWAY,
    model: env.ASSISTANT_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL}, assertActive, {observe: trace, onFailure: fail, tools: TOOL_BUDGET});
  const agent = new Agent(components.agent, {name: '博客助手', languageModel: model, tools: {search_blog: searchBlog},
    instructions: toolInstructions(), contextOptions: {recentMessages: 1, excludeToolMessages: true, searchOtherThreads: false},
    stopWhen: stepCountIs(TOOL_BUDGET.maxToolCalls + 1)});
  trace({stage: 'agent_start'});
  const result = await agent.streamText(ctx, {threadId: run.threadId}, {
    promptMessageId: run.promptMessageId, maxOutputTokens: 2048, temperature: 0.3,
    providerOptions: {'workers-ai': {reasoningEffort: TOOL_REASONING_EFFORT}},
    maxRetries: 0, abortSignal: controller.signal,
  }, {saveStreamDeltas: {throttleMs: 250}, contextHandler: async (_ctx, {threadId, inputPrompt}) => {
    if (threadId !== run.threadId || inputPrompt.length !== 1 || inputPrompt[0].role !== 'user') throw new Error(SAFE_ERROR);
    return [...history, ...inputPrompt];
  }});
  await result.consumeStream();
  trace({stage: 'agent_persisted'});
  if (!(await result.text).trim() || (await result.finishReason) !== 'stop') throw new Error(SAFE_ERROR);
  await ctx.runMutation(internal.assistant.finish, {runId, failed: false});
  trace({stage: 'completed', sourceCount: state.sources.length, toolCalls: state.toolCalls});
}
