/// <reference types="vite/client" />
import agentTest from '@convex-dev/agent/test';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
import {convexTest} from 'convex-test';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {api, components, internal} from './_generated/api';
import schema from './schema';
import {NO_SOURCES, SAFE_ERROR} from './assistantModel';

const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts']);
const paginationOpts = {numItems: 20, cursor: null};
const requestId = 'question-request-0001';
function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t); rateLimiterTest.register(t);
  const alice = t.withIdentity({issuer: 'https://auth.example.test', subject: 'alice'});
  const bob = t.withIdentity({issuer: 'https://auth.example.test', subject: 'bob'});
  return {t, alice, bob};
}
function configured() {
  vi.stubEnv('BLOG_RETRIEVAL_URL', 'https://blog.example.test/api/internal/retrieve');
  vi.stubEnv('RAG_BRIDGE_SECRET', 'test-only-server-bridge-secret-00000000000000');
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'a'.repeat(32));
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-only-model-token');
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('assistant authorization and persisted submissions', () => {
  test('anonymous calls and other users cannot create/read/send/cancel or retrieve sources', async () => {
    const {t, alice, bob} = setup();
    await expect(t.mutation(api.assistant.createConversation, {})).rejects.toThrow('UNAUTHENTICATED');
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const conversation = await alice.query(api.assistant.getConversation, {conversationId});
    for (const client of [t, bob, t.withIdentity({issuer: 'https://another.example.test', subject: 'alice'})]) {
      await expect(client.query(api.assistant.getConversation, {conversationId})).rejects.toThrow();
      await expect(client.mutation(api.assistant.sendMessage, {conversationId, prompt: '问题', requestId})).rejects.toThrow();
      await expect(client.mutation(api.assistant.cancel, {conversationId})).rejects.toThrow();
      await expect(client.query(api.assistant.getRunStates, {conversationId, orders: [0]})).rejects.toThrow();
      await expect(client.query(api.assistant.listThreadMessages, {threadId: conversation.threadId, paginationOpts})).rejects.toThrow();
    }
    expect((await bob.query(api.assistant.listConversations, {paginationOpts})).page).toEqual([]);
  });

  test('send ACK persists one prompt and run; retry is idempotent and a different prompt with that ID conflicts', async () => {
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const args = {conversationId, prompt: '契约测试有什么作用？', requestId};
    const first = await alice.mutation(api.assistant.sendMessage, args);
    expect(await alice.mutation(api.assistant.sendMessage, args)).toBe(first);
    await expect(alice.mutation(api.assistant.sendMessage, {...args, prompt: '另一个问题'})).rejects.toThrow('REQUEST_CONFLICT');
    await expect(alice.mutation(api.assistant.sendMessage, {...args, requestId: 'question-request-0002'})).rejects.toThrow('BUSY');
    const conversation = await alice.query(api.assistant.getConversation, {conversationId});
    const messages = await alice.query(api.assistant.listThreadMessages, {threadId: conversation.threadId, paginationOpts});
    expect(messages.page.map(message => message.text)).toEqual([args.prompt]);
    expect(JSON.stringify(messages)).not.toMatch(/tokenIdentifier|auth\.example|userId/);
    expect(await t.run(ctx => ctx.db.query('assistantRuns').take(10))).toHaveLength(1);
    expect(conversation.activeRun?.status).toBe('queued');
  });

  test('concurrent sends serialize and client-supplied ownership and unbounded input are rejected', async () => {
    const {alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    await expect(alice.mutation(api.assistant.sendMessage, {conversationId, prompt: 'x'.repeat(2001), requestId})).rejects.toThrow('INVALID_ARGUMENT');
    await expect(alice.mutation(api.assistant.sendMessage, {
      conversationId, prompt: '问题', requestId,
      // @ts-expect-error Ownership is derived from authenticated identity.
      owner: 'other',
    })).rejects.toThrow();
    const results = await Promise.allSettled([1, 2].map(index => alice.mutation(api.assistant.sendMessage, {conversationId, prompt: `问题 ${index}`, requestId: `parallel-request-${index}`})));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    await expect(alice.query(api.assistant.listConversations, {paginationOpts: {cursor: null, numItems: 1000}})).rejects.toThrow('INVALID_ARGUMENT');
  });

  test('cancellation is persisted before a queued job starts and late completion cannot overwrite it', async () => {
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '问题', requestId});
    await alice.mutation(api.assistant.cancel, {conversationId});
    expect(await t.mutation(internal.assistant.start, {runId})).toBeNull();
    await t.mutation(internal.assistant.finish, {runId, failed: false, noSources: true});
    const run = await t.run(ctx => ctx.db.get('assistantRuns', runId));
    expect(run?.status).toBe('canceled');
    expect((await alice.query(api.assistant.getConversation, {conversationId})).activeRun).toBeNull();
  });

  test('safety deadline creates a terminal failure without a browser or provider completion', async () => {
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '问题', requestId});
    await t.mutation(internal.assistant.start, {runId});
    await t.run(ctx => ctx.db.patch('assistantRuns', runId, {deadlineAt: Date.now() - 1}));
    await t.mutation(internal.assistant.expire, {runId});
    expect((await t.run(ctx => ctx.db.get('assistantRuns', runId)))?.status).toBe('failed');
    expect((await alice.query(api.assistant.getConversation, {conversationId})).activeRun).toBeNull();
  });

  test('a legitimate thread cannot be used with another user’s stream cursor', async () => {
    const {t, alice, bob} = setup();
    const aliceId = await alice.mutation(api.assistant.createConversation, {});
    const bobId = await bob.mutation(api.assistant.createConversation, {});
    const aliceThread = (await alice.query(api.assistant.getConversation, {conversationId: aliceId})).threadId;
    const bobThread = (await bob.query(api.assistant.getConversation, {conversationId: bobId})).threadId;
    const streamId = await t.run(async ctx => {
      const id = await ctx.runMutation(components.agent.streams.create, {threadId: aliceThread, order: 0, stepOrder: 1, format: 'UIMessageChunk'});
      await ctx.runMutation(components.agent.streams.addDelta, {streamId: id, start: 0, end: 1, parts: [{type: 'text-delta', id: 'text', delta: 'Alice private stream'}]});
      return id;
    });
    const streamArgs = {kind: 'deltas' as const, cursors: [{streamId, cursor: 0}]};
    const own = await alice.query(api.assistant.listThreadMessages, {threadId: aliceThread, paginationOpts: {cursor: null, numItems: 0}, streamArgs});
    expect(JSON.stringify(own.streams)).toContain('Alice private stream');
    await expect(bob.query(api.assistant.listThreadMessages, {threadId: bobThread, paginationOpts: {cursor: null, numItems: 0}, streamArgs})).rejects.toThrow('NOT_FOUND');
  });
});

describe('assistant retrieval and generation lifecycle', () => {
  test('no-source answer is durably saved, without calling a model', async () => {
    configured();
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({sources: [], snippets: []}));
    vi.stubGlobal('fetch', fetch);
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '问题', requestId});
    await t.action(internal.assistant.generate, {runId});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://blog.example.test/api/internal/retrieve');
    expect((await t.run(ctx => ctx.db.get('assistantRuns', runId)))?.status).toBe('completed');
    const conversation = await alice.query(api.assistant.getConversation, {conversationId});
    const messages = await alice.query(api.assistant.listThreadMessages, {threadId: conversation.threadId, paginationOpts});
    expect(messages.page.some(message => message.text === NO_SOURCES)).toBe(true);
  });

  test('retrieval failure is persisted with a safe error and cannot copy provider text into the transcript', async () => {
    configured();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('test-only-model-token private upstream error', {status: 502})));
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '问题', requestId});
    await t.action(internal.assistant.generate, {runId});
    const run = await t.run(ctx => ctx.db.get('assistantRuns', runId));
    expect(run?.status).toBe('failed'); expect(run?.error).toBe(SAFE_ERROR);
    expect(JSON.stringify(run)).not.toContain('test-only-model-token');
  });

  test('Agent streams through the fixed Gateway and saves visible answer and per-turn citations for reopening', async () => {
    configured();
    const source = {id: '1', title: '契约测试', url: 'https://yindongliang.com/docs/contract-testing/', sourceKind: 'author'};
    const calls: {url: string; init?: RequestInit}[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({url, init});
      if (url.includes('/api/internal/retrieve')) return Response.json({sources: [source], snippets: [{...source, source: '1', text: '契约测试校验服务接口约定。'}]});
      const chunk = (content: string, finishReason: string | null = null) => `data: ${JSON.stringify({id: 'test-completion', object: 'chat.completion.chunk', created: 1, model: 'qwen', choices: [{index: 0, delta: {content}, finish_reason: finishReason}]})}\n\n`;
      return new Response(chunk('<thi') + chunk('nk>private reasoning</think>') + chunk('契约测试校验服务接口约定。[1]') + chunk('', 'stop') + 'data: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});
    });
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '契约测试有什么作用？', requestId});
    const generation = t.action(internal.assistant.generate, {runId});
    await vi.advanceTimersByTimeAsync(1000);
    await generation;
    const run = await t.run(ctx => ctx.db.get('assistantRuns', runId));
    expect(run?.status).toBe('completed'); expect(run?.sources).toEqual([source]);
    const conversation = await alice.query(api.assistant.getConversation, {conversationId});
    const messages = await alice.query(api.assistant.listThreadMessages, {threadId: conversation.threadId, paginationOpts});
    expect(messages.page.find(message => message.role === 'assistant')?.text).toBe('契约测试校验服务接口约定。[1]');
    expect(JSON.stringify(messages)).not.toContain('private reasoning');
    const call = calls.find(call => call.url.includes('/ai/v1/'))!;
    expect(call.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/v1/chat/completions`);
    const headers = new Headers(call.init?.headers);
    expect(headers.get('cf-aig-gateway-id')).toBe('tcitry-blog-chat');
    expect(headers.get('cf-aig-skip-cache')).toBe('true');
    expect(headers.get('authorization')).toBe('Bearer test-only-model-token');
    expect(calls.filter(call => call.url.includes('/ai/v1/'))).toHaveLength(1);
  });

  test('cancel during retrieval prevents model invocation when its response eventually arrives', async () => {
    configured();
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(done => {resolve = done;}));
    vi.stubGlobal('fetch', fetch);
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '问题', requestId});
    const generation = t.action(internal.assistant.generate, {runId});
    await vi.advanceTimersByTimeAsync(10);
    await alice.mutation(api.assistant.cancel, {conversationId});
    resolve(Response.json({sources: [], snippets: []}));
    await generation;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await t.run(ctx => ctx.db.get('assistantRuns', runId)))?.status).toBe('canceled');
  });

  test('canceling a running stream stays canceled when a buffered final model response races with it', async () => {
    configured();
    const source = {id: '1', title: '文章', url: 'https://yindongliang.com/docs/example/', sourceKind: 'author'};
    let output!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const chunk = (text: string, finish_reason: string | null = null) => encoder.encode(`data: ${JSON.stringify({id: 'race', object: 'chat.completion.chunk', created: 1, model: 'qwen', choices: [{index: 0, delta: {content: text}, finish_reason}]})}\n\n`);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => String(input).includes('/api/internal/retrieve')
      ? Response.json({sources: [source], snippets: [{...source, source: '1', text: '公开内容'}]})
      : new Response(new ReadableStream<Uint8Array>({start(controller) {output = controller; controller.enqueue(chunk('已生成部分。'));}}), {headers: {'content-type': 'text/event-stream'}}));
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '问题', requestId});
    const generation = t.action(internal.assistant.generate, {runId});
    await vi.advanceTimersByTimeAsync(1000);
    await alice.mutation(api.assistant.cancel, {conversationId});
    // Provider bytes can already be in flight. Completion must never revive the
    // canceled application run even when the component saves a buffered tail.
    try { output.enqueue(chunk('缓冲尾部。', 'stop')); output.enqueue(encoder.encode('data: [DONE]\n\n')); output.close(); } catch { /* Upstream may already have been canceled. */ }
    await vi.advanceTimersByTimeAsync(1000);
    await generation;
    const run = await t.run(ctx => ctx.db.get('assistantRuns', runId));
    expect(run?.status).toBe('canceled');
    const state = await alice.query(api.assistant.getRunStates, {conversationId, orders: [run!.promptOrder]});
    expect(state[0].status).toBe('canceled');
    expect((await alice.query(api.assistant.getConversation, {conversationId})).activeRun).toBeNull();
  });
});
