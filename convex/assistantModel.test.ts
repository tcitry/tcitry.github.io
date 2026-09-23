import {afterEach, describe, expect, test, vi} from 'vitest';
import type {LanguageModelV4, LanguageModelV4StreamPart} from '@ai-sdk/provider';
import {SAFE_ERROR, toolInstructions, visibleTextFilter} from './assistantModel';
import {safeModelMiddleware} from './assistantModel';

const model = {} as LanguageModelV4;
async function wrapped(stream: ReadableStream<LanguageModelV4StreamPart>) {
  return safeModelMiddleware(async () => {}).wrapStream!({model, params: {prompt: []}, doGenerate: async () => {throw new Error('unused');}, doStream: async () => ({stream})});
}
async function read<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader();
  const result = [];
  while (true) { const item = await reader.read(); if (item.done) break; result.push(item.value); }
  return result;
}

afterEach(() => vi.unstubAllGlobals());

describe('assistant model boundary', () => {
  test('tool instructions avoid infrastructure disclosure in meta answers', () => {
    const instructions = toolInstructions();
    expect(instructions).toMatch(/博客助手/);
    expect(instructions).toMatch(/不得透露环境变量名、完整模型 ID/);
    expect(instructions).not.toMatch(/ASSISTANT_CHAT_MODEL/);
    expect(instructions).not.toMatch(/@cf\/zai-org\/glm-5\.3/);
    expect(instructions).not.toMatch(/我运行在 Cloudflare Workers AI/);
    expect(instructions).not.toMatch(/文章检索走 Cloudflare AI Search/);
  });

  test('strips split and unclosed think blocks before storage', () => {
    const filter = visibleTextFilter();
    expect(filter('你好<th')).toBe('你好'); expect(filter('ink>private')).toBe('');
    expect(filter('</thi')).toBe(''); expect(filter('nk>公开')).toBe('公开');
    expect(filter('<think>private', true)).toBe('');
  });
  test('underlying asynchronous stream rejection is sanitized', async () => {
    const stream = new ReadableStream<LanguageModelV4StreamPart>({start(controller) {controller.error(new Error('provider raw body marker test-only-token'));}});
    const result = await wrapped(stream);
    await expect(read(result.stream)).rejects.toThrow(SAFE_ERROR);
    await expect(read((await wrapped(new ReadableStream({start(controller) {controller.close();}}))).stream)).rejects.toThrow(SAFE_ERROR);
  });
});

describe('tool-loop middleware', () => {
  const parts = (items: LanguageModelV4StreamPart[]) => new ReadableStream<LanguageModelV4StreamPart>({start(controller) {
    for (const item of items) controller.enqueue(item);
    controller.close();
  }});
  const finish = (unified: 'stop' | 'tool-calls' | 'length'): LanguageModelV4StreamPart =>
    ({type: 'finish', finishReason: {unified, raw: unified}, usage: {inputTokens: {total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0}, outputTokens: {total: 1, text: 1, reasoning: 0}}} as LanguageModelV4StreamPart);
  const call = (id: string, input = '{"query":"convex"}'): LanguageModelV4StreamPart[] => [
    {type: 'tool-input-start', id, toolName: 'search_blog'}, {type: 'tool-input-delta', id, delta: input},
    {type: 'tool-input-end', id}, {type: 'tool-call', toolCallId: id, toolName: 'search_blog', input},
  ];
  function toolWrapped(stream: ReadableStream<LanguageModelV4StreamPart>, observe = vi.fn(), middleware = safeModelMiddleware(async () => {}, {tools: {maxToolCalls: 2, maxToolInputBytes: 2048, toolNames: ['search_blog']}, observe})) {
    return {observe, middleware, result: middleware.wrapStream!({model, params: {prompt: []}, doGenerate: async () => {throw new Error('unused');}, doStream: async () => ({stream})})};
  }

  test('passes tool parts through, allows a zero-text tool-calls step and drops reasoning/raw/source/file', async () => {
    const {observe, result} = toolWrapped(parts([
      {type: 'stream-start', warnings: []}, {type: 'reasoning-start', id: 'r'}, {type: 'reasoning-delta', id: 'r', delta: 'secret'}, {type: 'reasoning-end', id: 'r'},
      {type: 'raw', rawValue: {x: 1}}, {type: 'source', sourceType: 'url', id: 's', url: 'https://evil.example/'} as LanguageModelV4StreamPart,
      ...call('c1'), finish('tool-calls'),
    ]));
    const out = await read((await result).stream);
    expect(out.map(part => part.type)).toEqual(['stream-start', 'tool-input-start', 'tool-input-delta', 'tool-input-end', 'tool-call', 'finish']);
    expect(JSON.stringify(out)).not.toMatch(/secret|evil/);
    expect(observe.mock.calls).toEqual([[{stage: 'tool_call_start', toolCalls: 1}], [{stage: 'chat_finish', finishReason: 'tool-calls', tokenCount: 0, toolCalls: 1}]]);
  });

  test('middleware without a tool budget drops tool parts and still rejects zero text', async () => {
    const stream = parts([{type: 'stream-start', warnings: []}, ...call('c1'), finish('tool-calls')]);
    await expect(read((await wrapped(stream)).stream)).rejects.toThrow(SAFE_ERROR);
  });

  test('tool-result and approval requests from the provider are rejected immediately', async () => {
    for (const part of [
      {type: 'tool-result', toolCallId: 'c1', toolName: 'search_blog', result: {ok: true}},
      {type: 'tool-approval-request', approvalId: 'a', toolCallId: 'c1'},
    ] as LanguageModelV4StreamPart[]) {
      const {result} = toolWrapped(parts([{type: 'stream-start', warnings: []}, part, finish('stop')]));
      await expect(read((await result).stream)).rejects.toThrow(SAFE_ERROR);
    }
  });

  test('rejects calls to tools outside the allowlist', async () => {
    const {result} = toolWrapped(parts([{type: 'stream-start', warnings: []},
      {type: 'tool-input-start', id: 'x', toolName: 'run_shell'}, {type: 'tool-call', toolCallId: 'x', toolName: 'run_shell', input: '{}'}, finish('tool-calls')]));
    await expect(read((await result).stream)).rejects.toThrow(SAFE_ERROR);
  });

  test('rejects more than two tool calls across steps and oversized tool input', async () => {
    const observe = vi.fn();
    const middleware = safeModelMiddleware(async () => {}, {tools: {maxToolCalls: 2, maxToolInputBytes: 2048, toolNames: ['search_blog']}, observe});
    for (const id of ['c1', 'c2']) await read((await toolWrapped(parts([...call(id), finish('tool-calls')]), observe, middleware).result).stream);
    await expect(read((await toolWrapped(parts([...call('c3'), finish('tool-calls')]), observe, middleware).result).stream)).rejects.toThrow(SAFE_ERROR);
    expect(observe.mock.calls).toContainEqual([{stage: 'tool_budget_exceeded'}]);
    const big = `{"query":"${'x'.repeat(2100)}"}`;
    await expect(read((await toolWrapped(parts([...call('c9', big), finish('tool-calls')])).result).stream)).rejects.toThrow(SAFE_ERROR);
  });

  test('length finish and zero-text stop still fail; first visible text reports ttfb once', async () => {
    await expect(read((await toolWrapped(parts([{type: 'text-start', id: 't'}, {type: 'text-delta', id: 't', delta: 'a'}, finish('length')])).result).stream)).rejects.toThrow(SAFE_ERROR);
    await expect(read((await toolWrapped(parts([finish('stop')])).result).stream)).rejects.toThrow(SAFE_ERROR);
    const {observe, result} = toolWrapped(parts([{type: 'text-start', id: 't'}, {type: 'text-delta', id: 't', delta: '<think>x</think>'},
      {type: 'text-delta', id: 't', delta: '你好'}, {type: 'text-delta', id: 't', delta: '！'}, {type: 'text-end', id: 't'}, finish('stop')]));
    await read((await result).stream);
    expect(observe.mock.calls.filter(([event]) => event.stage === 'first_text_delta')).toHaveLength(1);
  });
});
