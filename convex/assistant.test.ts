/// <reference types="vite/client" />
import agentTest from '@convex-dev/agent/test';
import {saveMessage} from '@convex-dev/agent';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
import {convexTest} from 'convex-test';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import process from 'node:process';
import {api, components, internal} from './_generated/api';
import schema from './schema';
import {SAFE_ERROR} from './assistantModel';
import {mergeToolSources, resolveRunMode, validateToolQuery} from './assistant';

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
const reference = vi.hoisted(() => ({id: 'a'.repeat(64), key: `tcitry-blog/articles/${'a'.repeat(64)}.md`,
  hash: 'b'.repeat(64), title: '契约测试', url: 'https://yindongliang.com/docs/contract-testing/', sourceKind: 'author' as const}));
vi.mock('../.generated/ai-search/references.json', () => ({default: {documents: [reference]}}));
const source = {id: '1', title: reference.title, url: reference.url, sourceKind: reference.sourceKind};
const publicEndpoint = 'https://example.search.ai.cloudflare.com/search';
const publicItem = () => ({key: reference.key, metadata: {content_hash: reference.hash, canonical_url: reference.url, source_kind: reference.sourceKind}});
const searchResponse = () => Response.json({success: true, result: {chunks: [{item: publicItem(), score: 0.8, text: '契约测试校验服务接口约定。'}]}});
const sourcesEvent = () => `event: chunks\ndata: ${JSON.stringify([publicItem()])}\n\n`;
function configured() {
  vi.stubEnv('AI_SEARCH_PUBLIC_URL', publicEndpoint);
  for (const name of ['BLOG_RETRIEVAL_URL', 'RAG_BRIDGE_SECRET', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) vi.stubEnv(name, undefined);
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
      await expect(client.mutation(api.assistant.deleteConversation, {conversationId})).rejects.toThrow();
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

  test('deleteConversation removes the conversation, runs and agent thread for the owner only', async () => {
    const {t, alice, bob} = setup();
    const keepId = await alice.mutation(api.assistant.createConversation, {});
    const deleteId = await alice.mutation(api.assistant.createConversation, {});
    const keep = await alice.query(api.assistant.getConversation, {conversationId: keepId});
    const doomed = await alice.query(api.assistant.getConversation, {conversationId: deleteId});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId: deleteId, prompt: '待删除问题', requestId});
    await alice.mutation(api.assistant.deleteConversation, {conversationId: deleteId});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await alice.query(api.assistant.listConversations, {paginationOpts})).page.map(item => item.id)).toEqual([keepId]);
    await expect(alice.query(api.assistant.getConversation, {conversationId: deleteId})).rejects.toThrow('NOT_FOUND');
    expect(await t.run(ctx => ctx.db.get('assistantRuns', runId))).toBeNull();
    expect(await t.run(ctx => ctx.db.get('assistantConversations', deleteId))).toBeNull();
    expect(await t.run(ctx => ctx.runQuery(components.agent.threads.getThread, {threadId: doomed.threadId}))).toBeNull();
    expect((await alice.query(api.assistant.listThreadMessages, {threadId: keep.threadId, paginationOpts})).page).toEqual([]);
    await expect(bob.mutation(api.assistant.deleteConversation, {conversationId: deleteId})).rejects.toThrow();
    await expect(bob.mutation(api.assistant.deleteConversation, {conversationId: keepId})).rejects.toThrow();
  });

  test('deleteConversation cancels an active run before removing persisted data', async () => {
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '生成中', requestId});
    await t.mutation(internal.assistant.start, {runId});
    const conversation = await alice.query(api.assistant.getConversation, {conversationId});
    expect(conversation.activeRun?.status).toBe('running');
    await alice.mutation(api.assistant.deleteConversation, {conversationId});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run(ctx => ctx.db.get('assistantRuns', runId))).toBeNull();
    expect(await t.run(ctx => ctx.db.get('assistantConversations', conversationId))).toBeNull();
    expect(await t.run(ctx => ctx.runQuery(components.agent.threads.getThread, {threadId: conversation.threadId}))).toBeNull();
    expect((await alice.query(api.assistant.listConversations, {paginationOpts})).page).toEqual([]);
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
  test('no-source answer falls back to the model with empty sources', async () => {
    configured();
    const chatResponse = 'data: ' + JSON.stringify({id: 'fixture', object: 'chat.completion.chunk', created: 1,
      model: 'configured', choices: [{index: 0, delta: {content: '这是基于通用知识的回答。'}, finish_reason: 'stop'}]}) + '\n\n' +
      'data: [DONE]\n\n';
    const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).endsWith('/chat/completions')) {
        return new Response(chatResponse, {headers: {'content-type': 'text/event-stream'}});
      }
      return Response.json({success: true, result: {chunks: []}});
    });
    vi.stubGlobal('fetch', fetch);
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '问题', requestId});
    await t.action(internal.assistant.generate, {runId});
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][0]).toBe(publicEndpoint);
    expect(fetch.mock.calls[1][0]).toBe(publicEndpoint);
    expect(String(fetch.mock.calls[2][0])).toMatch(/\/chat\/completions$/);
    expect((await t.run(ctx => ctx.db.get('assistantRuns', runId)))?.status).toBe('completed');
    const conversation = await alice.query(api.assistant.getConversation, {conversationId});
    const messages = await alice.query(api.assistant.listThreadMessages, {threadId: conversation.threadId, paginationOpts});
    expect(messages.page.some(message => message.text === '这是基于通用知识的回答。')).toBe(true);
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

  test.each(['empty', 'wrong-hash', 'http-error'] as const)('invalid chat response (%s) fails through the real Agent promptly without an unhandled abort rejection', async invalid => {
    configured();
    const unhandled: unknown[] = [];
    const observeRejection = (reason: unknown) => {unhandled.push(reason);};
    const sdkErrors = vi.spyOn(console, 'error');
    // Observe rather than suppress the process event: Vitest retains its own
    // unhandled-rejection listener and must also fail if SDK cleanup leaks one.
    process.on('unhandledRejection', observeRejection);
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.endsWith('/search')) return searchResponse();
      if (invalid === 'http-error') return new Response('unapproved-provider-answer', {status: 503});
      const items = invalid === 'empty' ? [] : [{...publicItem(), metadata: {...publicItem().metadata, content_hash: 'c'.repeat(64)}}];
      const completion = {id: 'invalid-source-completion', object: 'chat.completion.chunk', created: 1, model: 'fixture-model',
        choices: [{index: 0, delta: {content: 'unapproved-provider-answer'}, finish_reason: 'stop'}]};
      return new Response(`event: chunks\ndata: ${JSON.stringify(items)}\n\ndata: ${JSON.stringify(completion)}\n\ndata: [DONE]\n\n`,
        {headers: {'content-type': 'text/event-stream'}});
    });
    try {
      const {t, alice} = setup();
      const conversationId = await alice.mutation(api.assistant.createConversation, {});
      const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '这些场景为什么需要实时查询？', requestId});
      let settled = false;
      let actionError: unknown;
      const generation = t.action(internal.assistant.generate, {runId}).then(() => {settled = true;}, error => {settled = true; actionError = error;});
      // This is far short of the 120-second expire fallback. Do not run queued
      // jobs to completion: that would hide a run stuck in "running".
      await vi.advanceTimersByTimeAsync(1000);
      expect(settled).toBe(true);
      await generation;
      expect(actionError).toBeUndefined();
      if (invalid === 'http-error') expect(sdkErrors.mock.calls.some(([message]) => message === 'onError')).toBe(true);
      expect(calls).toEqual([publicEndpoint, 'https://example.search.ai.cloudflare.com/chat/completions']);
      const run = await t.run(ctx => ctx.db.get('assistantRuns', runId));
      expect(run?.sources).toEqual([source]);
      expect(run?.status).toBe('failed');
      expect(run?.error).toBe(SAFE_ERROR);
      expect(Date.now()).toBeLessThan(run!.deadlineAt);
      const conversation = await alice.query(api.assistant.getConversation, {conversationId});
      expect(conversation.activeRun).toBeNull();
      const messages = await alice.query(api.assistant.listThreadMessages, {threadId: conversation.threadId, paginationOpts});
      expect(JSON.stringify(messages)).not.toContain('unapproved-provider-answer');
      await vi.advanceTimersByTimeAsync(1);
      expect(unhandled).toEqual([]);
    } finally {process.removeListener('unhandledRejection', observeRejection); sdkErrors.mockRestore();}
  });

  test('Agent uses credential-free public Search and Chat and saves the visible answer and per-turn citations for reopening', async () => {
    configured();
    const calls: {url: string; init?: RequestInit}[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({url, init});
      if (url.endsWith('/search')) return searchResponse();
      const chunk = (content: string, finishReason: string | null = null) => `data: ${JSON.stringify({id: 'test-completion', object: 'chat.completion.chunk', created: 1, model: 'qwen', choices: [{index: 0, delta: {content}, finish_reason: finishReason}]})}\n\n`;
      return new Response(sourcesEvent() + chunk('<thi') + chunk('nk>private reasoning</think>') + chunk('契约测试校验服务接口约定。[1]') + chunk('', 'stop') + 'data: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});
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
    const call = calls.find(call => call.url.endsWith('/chat/completions'))!;
    expect(call.url).toBe('https://example.search.ai.cloudflare.com/chat/completions');
    for (const request of calls) expect(new Headers(request.init?.headers).has('authorization')).toBe(false);
    const body = JSON.parse(String(call.init?.body));
    expect(body.model).toBeUndefined();
    expect(body.ai_search_options.retrieval.filters).toEqual({content_hash: {$in: [reference.hash]}});
    expect(body.messages.some((message: {role: string; content: string}) => message.role === 'system' && message.content.includes('契约测试校验'))).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test('a retry anchors to the last completed topic and excludes failed or canceled pairs without deleting them', async () => {
    configured();
    const searchQueries: string[] = [];
    const chatBodies: {messages: {role: string; content: string}[]}[] = [];
    let failNextChat = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(input).endsWith('/search')) {searchQueries.push(body.query); return searchResponse();}
      chatBodies.push(body);
      if (failNextChat) {failNextChat = false; return new Response('fixture generation failure', {status: 503});}
      const completion = {id: 'completed-topic', object: 'chat.completion.chunk', created: 1, model: 'fixture-model',
        choices: [{index: 0, delta: {content: '完整成功回答。[1]'}, finish_reason: 'stop'}]};
      return new Response(sourcesEvent() + `data: ${JSON.stringify(completion)}\n\ndata: [DONE]\n\n`, {headers: {'content-type': 'text/event-stream'}});
    });
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const successful = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '原始完整主题是什么？', requestId: 'completed-topic-0001'});
    let generation = t.action(internal.assistant.generate, {runId: successful});
    await vi.advanceTimersByTimeAsync(1000); await generation;
    expect((await t.run(ctx => ctx.db.get('assistantRuns', successful)))?.status).toBe('completed');
    const conversation = await alice.query(api.assistant.getConversation, {conversationId});

    failNextChat = true;
    const failed = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '失败追问不得取代主题', requestId: 'failed-topic-00002'});
    generation = t.action(internal.assistant.generate, {runId: failed});
    await vi.advanceTimersByTimeAsync(1000); await generation;
    expect((await t.run(ctx => ctx.db.get('assistantRuns', failed)))?.status).toBe('failed');
    await t.run(async ctx => {
      const run = await ctx.db.get('assistantRuns', failed);
      // Even a component-level success row must not override the failed app
      // run. This also models a buffered partial answer persisted during cleanup.
      await saveMessage(ctx, components.agent, {threadId: conversation.threadId, promptMessageId: run!.promptMessageId,
        message: {role: 'assistant', content: '失败轮次的部分回答'}});
    });

    const canceled = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '取消追问不得取代主题', requestId: 'canceled-topic-003'});
    await t.mutation(internal.assistant.start, {runId: canceled});
    await t.run(async ctx => {
      const run = await ctx.db.get('assistantRuns', canceled);
      await saveMessage(ctx, components.agent, {threadId: conversation.threadId, promptMessageId: run!.promptMessageId,
        message: {role: 'assistant', content: '取消轮次的部分回答'}});
    });
    await alice.mutation(api.assistant.cancel, {conversationId});

    const retry = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '再解释一下原因', requestId: 'retry-topic-000004'});
    generation = t.action(internal.assistant.generate, {runId: retry});
    await vi.advanceTimersByTimeAsync(1000); await generation;
    expect((await t.run(ctx => ctx.db.get('assistantRuns', retry)))?.status).toBe('completed');
    const query = '针对主题「」的追问。上文：原始完整主题是什么？。当前问题：再解释一下原因';
    expect(searchQueries.at(-1)).toBe(query);
    const messages = chatBodies.at(-1)!.messages;
    expect(messages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages.slice(1)).toEqual([
      {role: 'user', content: '原始完整主题是什么？'}, {role: 'assistant', content: '完整成功回答。[1]'}, {role: 'user', content: query},
    ]);
    expect(JSON.stringify(messages)).not.toMatch(/失败追问|取消追问|失败轮次|取消轮次/);
    const transcript = await alice.query(api.assistant.listThreadMessages, {threadId: conversation.threadId, paginationOpts});
    expect(JSON.stringify(transcript)).toContain('失败追问不得取代主题');
    expect(JSON.stringify(transcript)).toContain('取消追问不得取代主题');
    expect(JSON.stringify(transcript)).toContain('失败轮次的部分回答');
    expect(JSON.stringify(transcript)).toContain('取消轮次的部分回答');
    expect((await t.run(ctx => ctx.db.get('assistantRuns', failed)))?.status).toBe('failed');
    expect((await t.run(ctx => ctx.db.get('assistantRuns', canceled)))?.status).toBe('canceled');
  });

  test('completed context is limited to four valid rounds in the same conversation and owner', async () => {
    const {t, alice, bob} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const otherId = await bob.mutation(api.assistant.createConversation, {});
    await t.run(async ctx => {
      for (const [id, count] of [[conversationId, 6], [otherId, 1]] as const) {
        const conversation = await ctx.db.get('assistantConversations', id);
        for (let index = 0; index < count; index++) {
          const question = id === otherId ? '另一个账户的私密主题' : `成功问题 ${index}`;
          const saved = await saveMessage(ctx, components.agent, {threadId: conversation!.threadId, prompt: question});
          await saveMessage(ctx, components.agent, {threadId: conversation!.threadId, promptMessageId: saved.messageId,
            message: {role: 'assistant', content: `完整回答 ${index}`}});
          await ctx.db.insert('assistantRuns', {conversationId: id, owner: conversation!.owner, requestId: `seed-success-${index}`,
            promptMessageId: saved.messageId, promptOrder: saved.message.order, status: 'completed', sources: [], createdAt: Date.now(), deadlineAt: Date.now() + 120_000});
        }
      }
      const conversation = await ctx.db.get('assistantConversations', conversationId);
      const invalidOwner = await saveMessage(ctx, components.agent, {threadId: conversation!.threadId, prompt: '归属不匹配的主题'});
      await saveMessage(ctx, components.agent, {threadId: conversation!.threadId, promptMessageId: invalidOwner.messageId,
        message: {role: 'assistant', content: '归属不匹配的回答'}});
      await ctx.db.insert('assistantRuns', {conversationId, owner: 'different-owner', requestId: 'seed-wrong-owner',
        promptMessageId: invalidOwner.messageId, promptOrder: invalidOwner.message.order, status: 'completed', sources: [], createdAt: Date.now(), deadlineAt: Date.now() + 120_000});
    });
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '当前问题', requestId});
    await t.mutation(internal.assistant.start, {runId});
    const context = await t.query(internal.assistant.completedContext, {runId});
    expect(context?.previousQuestion).toBe('成功问题 5');
    expect(context?.messages).toEqual([2, 3, 4, 5].flatMap(index => [
      {role: 'user', content: `成功问题 ${index}`}, {role: 'assistant', content: `完整回答 ${index}`},
    ]));
    expect(JSON.stringify(context)).not.toMatch(/私密|归属不匹配/);
    await alice.mutation(api.assistant.cancel, {conversationId});
    expect(await t.query(internal.assistant.completedContext, {runId})).toBeNull();
  });

  test('completed context keeps a tool-loop round: last text-only assistant step wins, tool steps are skipped', async () => {
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    await t.run(async ctx => {
      const conversation = await ctx.db.get('assistantConversations', conversationId);
      const saved = await saveMessage(ctx, components.agent, {threadId: conversation!.threadId, prompt: '工具轮次问题'});
      // Same order as the prompt, ascending stepOrder: tool call, tool result, final text.
      await saveMessage(ctx, components.agent, {threadId: conversation!.threadId, promptMessageId: saved.messageId,
        message: {role: 'assistant', content: [{type: 'tool-call', toolCallId: 'c1', toolName: 'search_blog', input: {query: '内部检索词'}}]}});
      await saveMessage(ctx, components.agent, {threadId: conversation!.threadId, promptMessageId: saved.messageId,
        message: {role: 'tool', content: [{type: 'tool-result', toolCallId: 'c1', toolName: 'search_blog', output: {type: 'json', value: {ok: true, results: [{text: '内部片段'}]}}}]}});
      await saveMessage(ctx, components.agent, {threadId: conversation!.threadId, promptMessageId: saved.messageId,
        message: {role: 'assistant', content: '工具轮次最终回答。[1]'}});
      await ctx.db.insert('assistantRuns', {conversationId, owner: conversation!.owner, requestId: 'seed-tool-round-001',
        promptMessageId: saved.messageId, promptOrder: saved.message.order, status: 'completed', sources: [], createdAt: Date.now(), deadlineAt: Date.now() + 120_000,
        mode: 'tool', phase: 'writing', toolCalls: 1});
    });
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '当前问题', requestId});
    await t.mutation(internal.assistant.start, {runId});
    const context = await t.query(internal.assistant.completedContext, {runId});
    expect(context).toEqual({previousQuestion: '工具轮次问题', messages: [
      {role: 'user', content: '工具轮次问题'}, {role: 'assistant', content: '工具轮次最终回答。[1]'},
    ]});
    expect(JSON.stringify(context)).not.toMatch(/内部检索词|内部片段/);
    const states = await alice.query(api.assistant.getRunStates, {conversationId, orders: [(await t.run(ctx => ctx.db.get('assistantRuns', runId)))!.promptOrder]});
    expect(states[0]).toMatchObject({status: 'running', phase: 'searching', toolCalls: 0});
  });

  test('completed context does not scan past 32 preceding runs or reuse an incomplete successful pair', async () => {
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    await t.run(async ctx => {
      const conversation = await ctx.db.get('assistantConversations', conversationId);
      for (let index = 0; index < 33; index++) {
        const saved = await saveMessage(ctx, components.agent, {threadId: conversation!.threadId, prompt: `历史问题 ${index}`});
        if (index === 0) await saveMessage(ctx, components.agent, {threadId: conversation!.threadId, promptMessageId: saved.messageId,
          message: {role: 'assistant', content: '窗口之外的完整回答'}});
        await ctx.db.insert('assistantRuns', {conversationId, owner: conversation!.owner, requestId: `seed-window-${index}`,
          promptMessageId: saved.messageId, promptOrder: saved.message.order, status: index === 0 || index === 32 ? 'completed' : 'failed',
          sources: [], createdAt: Date.now(), deadlineAt: Date.now() + 120_000});
      }
    });
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '当前问题', requestId});
    await t.mutation(internal.assistant.start, {runId});
    expect(await t.query(internal.assistant.completedContext, {runId})).toEqual({previousQuestion: null, messages: []});
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
    resolve(Response.json({success: true, result: {chunks: []}}));
    await generation;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await t.run(ctx => ctx.db.get('assistantRuns', runId)))?.status).toBe('canceled');
  });

  test('canceling a running stream stays canceled when a buffered final model response races with it', async () => {
    configured();
    let output!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const chunk = (text: string, finish_reason: string | null = null) => encoder.encode(`data: ${JSON.stringify({id: 'race', object: 'chat.completion.chunk', created: 1, model: 'qwen', choices: [{index: 0, delta: {content: text}, finish_reason}]})}\n\n`);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => String(input).endsWith('/search')
      ? searchResponse()
      : new Response(new ReadableStream<Uint8Array>({start(controller) {output = controller; controller.enqueue(encoder.encode(sourcesEvent())); controller.enqueue(chunk('已生成部分。'));}}), {headers: {'content-type': 'text/event-stream'}}));
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

describe('search-as-tool helpers', () => {
  test('resolveRunMode defaults off, honours on, and gates allowlist by owner', () => {
    expect(resolveRunMode('u1', undefined, undefined)).toBe('legacy');
    expect(resolveRunMode('u1', 'off', 'u1')).toBe('legacy');
    expect(resolveRunMode('u1', 'on', undefined)).toBe('tool');
    expect(resolveRunMode('u1', 'allowlist', ' u0, u1 ')).toBe('tool');
    expect(resolveRunMode('u2', 'allowlist', 'u0,u1')).toBe('legacy');
    expect(resolveRunMode('u1', 'bogus', 'u1')).toBe('legacy');
  });

  test('validateToolQuery trims, caps at 200 chars and refuses control characters', () => {
    expect(validateToolQuery('  convex agent  ')).toBe('convex agent');
    expect(validateToolQuery('')).toBeNull(); expect(validateToolQuery('   ')).toBeNull();
    expect(validateToolQuery(42)).toBeNull();
    expect(validateToolQuery('x'.repeat(201))).toBeNull(); expect(validateToolQuery('x'.repeat(200))).toHaveLength(200);
    expect(validateToolQuery('bad\u0000query')).toBeNull(); expect(validateToolQuery('bad\u001bquery')).toBeNull();
    expect(validateToolQuery('多行\n允许')).toBe('多行\n允许');
  });

  test('mergeToolSources dedupes by URL, keeps numbering stable, caps at 5 sources and shares one snippet budget', () => {
    const state = {sources: [] as {id: string; title: string; url: string; sourceKind: 'author' | 'ai-assisted'}[], snippets: [] as {source: string; title: string; sourceKind: 'author' | 'ai-assisted'; text: string}[], budgetLeft: 30};
    const src = (id: string, n: number) => ({id, title: `T${n}`, url: `https://yindongliang.com/p/${n}/`, sourceKind: 'author' as const});
    const first = mergeToolSources(state, {sources: [src('1', 1), src('2', 2)], snippets: [{source: '1', title: 'T1', sourceKind: 'author', text: 'aaaaaaaaaa'}, {source: '2', title: 'T2', sourceKind: 'author', text: 'bbbbbbbbbb'}]});
    expect(first.map(s => s.source)).toEqual(['1', '2']);
    expect(state.budgetLeft).toBe(10);
    const second = mergeToolSources(state, {sources: [src('1', 2), src('2', 3), src('3', 4), src('4', 5), src('5', 6), src('6', 7)],
      snippets: [{source: '1', title: 'T2', sourceKind: 'author', text: 'bbbbbbbbbb'}, {source: '2', title: 'T3', sourceKind: 'author', text: 'cccccccccccccccc'}, {source: '3', title: 'T4', sourceKind: 'author', text: 'dddd'}]});
    expect(state.sources.map(s => s.id + ':' + s.url)).toEqual(['1:https://yindongliang.com/p/1/', '2:https://yindongliang.com/p/2/', '3:https://yindongliang.com/p/3/', '4:https://yindongliang.com/p/4/', '5:https://yindongliang.com/p/5/']);
    expect(second).toEqual([{source: '3', title: 'T3', sourceKind: 'author', text: 'cccccccccc'}]);
    expect(state.budgetLeft).toBe(0);
    expect(JSON.stringify(second)).not.toContain('http');
  });
});

describe('search-as-tool generation lifecycle', () => {
  const accountId = 'f'.repeat(32);
  const workersUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
  function toolConfigured() {
    vi.stubEnv('AI_SEARCH_PUBLIC_URL', publicEndpoint);
    vi.stubEnv('ASSISTANT_TOOL_MODE', 'on');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', accountId);
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token-value-not-a-real-credential');
  }
  const sse = (frames: object[]) => new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});
  const chunk = (delta: object, finish_reason: string | null = null) => ({id: 'wai', object: 'chat.completion.chunk', created: 1, model: '@cf/zai-org/glm-5.3', choices: [{index: 0, delta, finish_reason}]});
  const toolCallFrames = (query: string) => [chunk({role: 'assistant', tool_calls: [{index: 0, id: 'call_1', type: 'function', function: {name: 'search_blog', arguments: JSON.stringify({query})}}]}), chunk({}, 'tool_calls')];

  test('blog fact: model calls search_blog once, validated sources are persisted, tool output carries no URL, phases progress', async () => {
    toolConfigured();
    const calls: {url: string; body: {messages?: {role: string; content?: unknown; tool_calls?: unknown}[]; tools?: unknown; query?: string; reasoning_effort?: string}; headers: Headers}[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const body = JSON.parse(String(init?.body)); calls.push({url, body, headers: new Headers(init?.headers)});
      if (url.endsWith('/search')) return Response.json({success: true, result: {chunks: [
        {item: publicItem(), score: 0.8, text: '契约测试校验服务接口约定。'},
        {item: {key: reference.key, metadata: {content_hash: 'c'.repeat(64), canonical_url: reference.url, source_kind: 'author'}}, score: 0.9, text: '伪造哈希片段'},
        {item: {key: reference.key, metadata: {content_hash: reference.hash, canonical_url: 'https://evil.example/phish/', source_kind: 'author'}}, score: 0.9, text: '篡改链接片段'},
        {item: {key: 'tcitry-blog/private/secret.md', metadata: {content_hash: reference.hash, canonical_url: reference.url, source_kind: 'author'}}, score: 0.9, text: '未知 key 片段'},
      ]}});
      const step = calls.filter(call => call.url === workersUrl).length;
      if (step === 1) return sse(toolCallFrames('契约测试 作用'));
      return sse([chunk({role: 'assistant', content: '契约测试用于校验接口约定。'}), chunk({content: '[来源 1]'}, 'stop')]);
    });
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '契约测试有什么作用？', requestId});
    const generation = t.action(internal.assistant.generate, {runId});
    await vi.advanceTimersByTimeAsync(1000);
    await generation;
    const run = await t.run(ctx => ctx.db.get('assistantRuns', runId));
    expect(run).toMatchObject({status: 'completed', mode: 'tool', phase: 'writing', toolCalls: 1, sources: [source]});
    const conversation = await alice.query(api.assistant.getConversation, {conversationId});
    const messages = await alice.query(api.assistant.listThreadMessages, {threadId: conversation.threadId, paginationOpts});
    expect(messages.page.filter(message => message.role === 'assistant').map(message => message.text).join('')).toContain('契约测试用于校验接口约定。');
    const model = calls.filter(call => call.url === workersUrl);
    expect(model).toHaveLength(2);
    expect(model[0].headers.get('cf-aig-gateway-id')).toBe('tcitry-blog-chat');
    expect(model[0].headers.get('authorization')).toMatch(/^Bearer /);
    expect(model[0].body.reasoning_effort).toBe('low');
    expect(model[0].body.tools).toHaveLength(1);
    const toolMessage = model[1].body.messages!.find(message => message.role === 'tool');
    const toolText = JSON.stringify(toolMessage);
    expect(toolText).toContain('契约测试校验服务接口约定');
    expect(toolText).not.toMatch(/https?:|伪造哈希|篡改链接|未知 key|evil\.example/);
    expect(JSON.stringify(model[1].body.messages)).not.toMatch(/evil\.example|yindongliang\.com/);
    const search = calls.find(call => call.url.endsWith('/search'))!;
    expect(search.headers.has('authorization')).toBe(false);
    expect(search.body.query).toBe('契约测试 作用');
  });

  test('chitchat: model answers directly with zero searches and no sources', async () => {
    toolConfigured();
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return sse([chunk({role: 'assistant', content: '你好！'}), chunk({content: '有什么可以帮你？'}, 'stop')]);
    });
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '你好', requestId});
    const generation = t.action(internal.assistant.generate, {runId});
    await vi.advanceTimersByTimeAsync(1000);
    await generation;
    const run = await t.run(ctx => ctx.db.get('assistantRuns', runId));
    expect(run).toMatchObject({status: 'completed', mode: 'tool', toolCalls: 0, sources: []});
    expect(urls).toEqual([workersUrl]);
  });

  test('search failure returns an unavailable tool result and the model still finishes; a third tool call fails the run safely', async () => {
    toolConfigured();
    let modelCalls = 0; let toolMessages: unknown[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/search')) return new Response('upstream private failure text', {status: 503});
      modelCalls += 1;
      const body = JSON.parse(String(init?.body));
      toolMessages = body.messages.filter((message: {role: string}) => message.role === 'tool');
      if (modelCalls === 1) return sse(toolCallFrames('契约测试'));
      return sse([chunk({role: 'assistant', content: '博客中暂未找到足够依据。'}, 'stop')]);
    });
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '契约测试有什么作用？', requestId});
    let generation = t.action(internal.assistant.generate, {runId});
    await vi.advanceTimersByTimeAsync(1000); await generation;
    expect(await t.run(ctx => ctx.db.get('assistantRuns', runId))).toMatchObject({status: 'completed', toolCalls: 1, sources: []});
    expect(JSON.stringify(toolMessages)).toContain('unavailable');
    expect(JSON.stringify(toolMessages)).not.toContain('upstream private failure');

    modelCalls = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/search')) return searchResponse();
      modelCalls += 1;
      return sse(toolCallFrames(`第 ${modelCalls} 次`));
    });
    const second = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '再查一次', requestId: 'question-request-0002'});
    generation = t.action(internal.assistant.generate, {runId: second});
    await vi.advanceTimersByTimeAsync(1000); await generation;
    const run = await t.run(ctx => ctx.db.get('assistantRuns', second));
    expect(run?.status).toBe('failed'); expect(run?.error).toBe(SAFE_ERROR);
    expect(modelCalls).toBeLessThanOrEqual(3);
  });

  test('tool mode without Cloudflare credentials fails safely before any network call', async () => {
    toolConfigured(); vi.stubEnv('CLOUDFLARE_API_TOKEN', undefined);
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const {t, alice} = setup();
    const conversationId = await alice.mutation(api.assistant.createConversation, {});
    const runId = await alice.mutation(api.assistant.sendMessage, {conversationId, prompt: '契约测试有什么作用？', requestId});
    const generation = t.action(internal.assistant.generate, {runId});
    await vi.advanceTimersByTimeAsync(1000); await generation;
    expect(await t.run(ctx => ctx.db.get('assistantRuns', runId))).toMatchObject({status: 'failed', error: SAFE_ERROR, mode: 'tool'});
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
