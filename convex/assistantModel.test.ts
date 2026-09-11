import {afterEach, describe, expect, test, vi} from 'vitest';
import type {LanguageModelV4, LanguageModelV4StreamPart} from '@ai-sdk/provider';
import {streamText} from 'ai';
import {publicChatModel, verifiedCompletionStream, SAFE_ERROR, visibleTextFilter} from './assistantModel';
import {safeModelMiddleware} from './assistantModel';
import type {PublicSearchReference} from './assistantPublicSearch';

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

const approved: PublicSearchReference = {id: 'a'.repeat(64), key: `tcitry-blog/articles/${'a'.repeat(64)}.md`, hash: 'b'.repeat(64),
  title: '可信文章', url: 'https://yindongliang.com/docs/fixture/', sourceKind: 'ai-assisted'};
const item = {key: approved.key, timestamp: 1788885690000, metadata: {canonical_url: approved.url, content_hash: approved.hash,
  source_kind: approved.sourceKind, section: 'docs', updated_at: 1788885690000, chunk_modality: 'text', schema_version: 2}};
const chunks = (items: unknown = [item]) => `event: chunks\r\ndata: ${JSON.stringify(items)}\r\n\r\n`;
const completion = (content: string, finish_reason: string | null = null) => ({id: 'fixture-completion', object: 'chat.completion.chunk', created: 1,
  model: 'configured-instance-model', choices: [{index: 0, delta: {content}, finish_reason}]});
const delta = (content: string, finish: string | null = null) => `data: ${JSON.stringify(completion(content, finish))}\r\n\r\n`;
const done = 'data: [DONE]\r\n\r\n';
function bytes(text: string, split = 11) {
  const encoded = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({pull(controller) {
    if (offset === encoded.length) {controller.close(); return;}
    controller.enqueue(encoded.slice(offset, offset + split)); offset = Math.min(offset + split, encoded.length);
  }});
}
afterEach(() => vi.unstubAllGlobals());

describe('assistant model boundary', () => {
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

describe('verified public completion SSE', () => {
  test('handles byte-split UTF-8 and CRLF frames, removes source events and forwards OpenAI data in order', async () => {
    const stream = verifiedCompletionStream(bytes(': keepalive\r\n\r\n' + chunks() + delta('中文公开内容。[1]') + delta('', 'stop') + done, 1), [approved]);
    expect(await new Response(stream).text()).toBe(`data: ${JSON.stringify(completion('中文公开内容。[1]'))}\n\ndata: ${JSON.stringify(completion('', 'stop'))}\n\ndata: [DONE]\n\n`);
  });

  test('rejects missing, malformed, duplicate or unsupported source events before exposing text', async () => {
    const wrongHash = {...item, metadata: {...item.metadata, content_hash: 'c'.repeat(64)}};
    const wrongURL = {...item, metadata: {...item.metadata, canonical_url: 'https://attacker.test/'}};
    const wrongKind = {...item, metadata: {...item.metadata, source_kind: 'author'}};
    const unknown = {...item, key: `tcitry-blog/articles/${'c'.repeat(64)}.md`};
    const cases = ['', chunks([]), chunks({chunks: [item]}), chunks([null]), chunks([wrongHash]), chunks([wrongURL]),
      chunks([wrongKind]), chunks([unknown]), chunks([item, unknown]), chunks(Array(51).fill(item)), chunks() + chunks(),
      'event: chunks\ndata: invalid-json\n\n', 'event: error\ndata: {"message":"private marker"}\n\n'];
    for (const prefix of cases) {
      const reader = verifiedCompletionStream(bytes(prefix + delta('必须不可见') + done), [approved]).getReader();
      const seen: Uint8Array[] = [];
      try {
        await expect((async () => {while (true) {const part = await reader.read(); if (part.done) break; seen.push(part.value);}})()).rejects.toThrow();
        expect(seen).toHaveLength(0);
      } finally {reader.releaseLock();}
    }
  });

  test('requires DONE, refuses unsupported payloads and rejects incomplete or already-buffered trailing frames', async () => {
    for (const input of [chunks() + delta('partial'), chunks() + delta('partial', 'stop'),
      chunks() + 'data: {"error":"private marker"}\n\n', chunks() + 'event: unexpected\ndata: {}\n\n',
      chunks() + delta('text', 'stop') + done + delta('late'), chunks() + delta('text', 'stop') + done + 'data: partial']) {
      // Bytes following DONE in this received packet must be validated before
      // closing; a completed stream need not wait for future network packets.
      await expect(new Response(verifiedCompletionStream(bytes(input, 2_000_000), [approved])).text()).rejects.toThrow();
    }
  });

  test('caps total bytes and unterminated frame size', async () => {
    await expect(new Response(verifiedCompletionStream(bytes('x'.repeat(200_001), 200_001), [approved])).text()).rejects.toThrow(SAFE_ERROR);
    await expect(new Response(verifiedCompletionStream(bytes('x'.repeat(2_000_001), 2_000_001), [approved])).text()).rejects.toThrow(SAFE_ERROR);
  });

  test('canceling the transformed response cancels the underlying network reader', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({start(controller) {controller.enqueue(new TextEncoder().encode(chunks() + delta('部分内容')));}, cancel});
    const reader = verifiedCompletionStream(body, [approved]).getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1), {timeout: 1000, interval: 5});
    reader.releaseLock();
  });

  test('DONE ends the response and releases an upstream socket that remains open', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({start(controller) {controller.enqueue(new TextEncoder().encode(chunks() + delta('完整回答', 'stop') + done));}, cancel});
    const reader = verifiedCompletionStream(body, [approved]).getReader();
    const completed = (async () => {while (!(await reader.read()).done) { /* Consume the verified completion. */ } return true;})();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const closed = await Promise.race([completed, new Promise<false>(resolve => {timeout = setTimeout(() => resolve(false), 250);})]);
      expect(closed).toBe(true);
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1), {timeout: 1000, interval: 5});
    } finally {clearTimeout(timeout); await reader.cancel(); await completed; reader.releaseLock();}
  });
});

describe('public AI Search language model', () => {
  test('SDK consumeStream finishes first and follow-up turns at DONE even when network cancellation is still pending', async () => {
    for (const followup of [false, true]) {
      let releaseCancel: (() => void) | undefined;
      const cancelled = new Promise<void>(resolve => {releaseCancel = resolve;});
      const cancel = vi.fn(() => cancelled);
      const body = new ReadableStream<Uint8Array>({start(controller) {
        const emptyChoices = `data: ${JSON.stringify({...completion(''), choices: []})}\n\n`;
        controller.enqueue(new TextEncoder().encode(': keepalive\n\n' + chunks() + emptyChoices + delta('完整回答。[1]') + delta('', 'stop') + done));
        // Neither EOF nor a resolved cancellation promise is supplied until
        // after consumeStream has been required to finish.
      }, cancel});
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {headers: {'content-type': 'text/event-stream'}})));
      const abort = new AbortController();
      const result = streamText({model: publicChatModel('https://search.example.com', [approved], async () => {}),
        messages: followup ? [{role: 'user', content: '首问'}, {role: 'assistant', content: '首轮回答。[1]'}, {role: 'user', content: '继续解释'}]
          : [{role: 'user', content: '首问'}], abortSignal: abort.signal, maxRetries: 0});
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const consuming = result.consumeStream().then(() => true);
      try {
        expect(await Promise.race([consuming, new Promise<false>(resolve => {timeout = setTimeout(() => resolve(false), 500);})])).toBe(true);
        expect(await result.text).toBe('完整回答。[1]');
        expect(await result.finishReason).toBe('stop');
        await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1), {timeout: 1000, interval: 5});
      } finally {clearTimeout(timeout); releaseCancel?.(); abort.abort(); await consuming;}
    }
  });

  test('stop without DONE stays incomplete, but abort reaches an idle follow-up response and releases consumeStream', async () => {
    const networkAbort = vi.fn();
    let fetchSignal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchSignal = init?.signal;
      const body = new ReadableStream<Uint8Array>({start(controller) {
        controller.enqueue(new TextEncoder().encode(chunks() + delta('部分回答。[1]', 'stop')));
        // Model a native fetch response that remains idle until its supplied
        // signal aborts. Merely seeing finish_reason does not replace DONE.
        fetchSignal?.addEventListener('abort', () => {
          networkAbort(); controller.error(new DOMException('fixture provider transport aborted', 'AbortError'));
        }, {once: true});
      }});
      return new Response(body, {headers: {'content-type': 'text/event-stream'}});
    }));
    const abort = new AbortController();
    let seen = '';
    let settled = false;
    const result = streamText({model: publicChatModel('https://search.example.com/search', [approved], async () => {}),
      messages: [{role: 'user', content: '首问'}, {role: 'assistant', content: '首轮回答'}, {role: 'user', content: '为什么'}],
      abortSignal: abort.signal, maxRetries: 0,
      onChunk({chunk}) {if (chunk.type === 'text-delta') seen += chunk.text;},
      onError() {},
    });
    const consuming = result.consumeStream().then(() => {settled = true;}, () => {settled = true;});
    try {
      await vi.waitFor(() => expect(seen).toBe('部分回答。[1]'), {timeout: 1000, interval: 5});
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(settled).toBe(false);
      expect(fetchSignal).toBeDefined();
      abort.abort(new DOMException('fixture deadline', 'AbortError'));
      await vi.waitFor(() => expect(settled).toBe(true), {timeout: 1000, interval: 5});
      expect(fetchSignal?.aborted).toBe(true);
      expect(networkAbort).toHaveBeenCalledTimes(1);
    } finally {abort.abort(); await consuming;}
  });

  test('uses the provider V4 stream, preserves message context, omits model and identity credentials, and restricts hashes', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(bytes(chunks() + delta('<thi') + delta('nk>private reasoning</think>') + delta('公开回答。[1]') + delta('', 'stop') + done), {headers: {'content-type': 'text/event-stream'}}));
    vi.stubGlobal('fetch', fetcher);
    const assertActive = vi.fn(async () => {});
    const model = publicChatModel('https://search.example.com/search', [approved], assertActive);
    expect(model.specificationVersion).toBe('v4');
    const result = await model.doStream({prompt: [
      {role: 'system', content: '本轮可信片段与规则'},
      {role: 'user', content: [{type: 'text', text: '上一问题'}]},
      {role: 'assistant', content: [{type: 'text', text: '上一回答'}]},
      {role: 'user', content: [{type: 'text', text: '当前追问'}]},
    ], maxOutputTokens: 2048, temperature: 0.3});
    const output = await read(result.stream);
    expect(output.filter(part => part.type === 'text-delta').map(part => part.delta).join('')).toBe('公开回答。[1]');
    expect(JSON.stringify(output)).not.toContain('private reasoning');
    expect(output.some(part => part.type === 'finish' && part.finishReason.unified === 'stop')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(assertActive).toHaveBeenCalled();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://search.example.com/chat/completions');
    expect(init?.redirect).toBe('error');
    expect(init?.credentials).toBe('omit');
    const headers = new Headers(init?.headers);
    expect(headers.has('authorization')).toBe(false); expect(headers.has('cookie')).toBe(false);
    const body = JSON.parse(String(init?.body));
    expect(body).not.toHaveProperty('model'); expect(body).not.toHaveProperty('user');
    expect(body.messages).toEqual([
      {role: 'system', content: '本轮可信片段与规则'}, {role: 'user', content: '上一问题'},
      {role: 'assistant', content: '上一回答'}, {role: 'user', content: '当前追问'},
    ]);
    expect(body.ai_search_options.retrieval.filters).toEqual({content_hash: {$in: [approved.hash]}});
    expect(body.ai_search_options).toMatchObject({query_rewrite: {enabled: false}, reranking: {enabled: true}, cache: {enabled: true}});
    expect(body.stream).toBe(true);
  });

  test('uses the contextual retrieval query only for the last user message without mutating history', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(bytes(chunks() + delta('公开回答。[1]', 'stop') + done), {headers: {'content-type': 'text/event-stream'}}));
    vi.stubGlobal('fetch', fetcher);
    const contextual = '上一个问题：原始首问\n当前问题：原始追问';
    const observe = vi.fn();
    const onFailure = vi.fn(async () => {});
    const model = publicChatModel('https://search.example.com/search', [approved], async () => {}, {retrievalQuery: contextual, observe, onFailure, inspectMessageShape: true});
    const prompt: Parameters<LanguageModelV4['doStream']>[0]['prompt'] = [
      {role: 'system', content: '原始系统规则'},
      {role: 'user', content: [{type: 'text', text: '原始首问'}]},
      {role: 'assistant', content: [{type: 'text', text: '原始回答'}]},
      {role: 'user', content: [{type: 'text', text: '原始追问'}]},
    ];
    const original = structuredClone(prompt);
    await read((await model.doStream({prompt})).stream);
    expect(prompt).toEqual(original);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.messages).toEqual([
      {role: 'system', content: '原始系统规则'}, {role: 'user', content: '原始首问'},
      {role: 'assistant', content: '原始回答'}, {role: 'user', content: contextual},
    ]);
    expect(body.ai_search_options.retrieval).toEqual({
      retrieval_type: 'hybrid', match_threshold: 0.4, return_on_failure: false,
      filters: {content_hash: {$in: [approved.hash]}}, max_num_results: 10,
    });
    expect(body.ai_search_options).toMatchObject({query_rewrite: {enabled: false}, reranking: {enabled: true}, cache: {enabled: true}});
    expect(body).not.toHaveProperty('model');
    expect(body).not.toHaveProperty('user');
    expect(onFailure).not.toHaveBeenCalled();
    expect(observe.mock.calls).toEqual([
      [{stage: 'chat_request'}],
      [{stage: 'chat_request_shape', messageRoles: ['system', 'user', 'assistant', 'user'],
        contentKinds: ['text', 'text', 'text', 'text'], contentLengths: ['原始系统规则', '原始首问', '原始回答', contextual].map(text => text.length)}],
      [{stage: 'chat_headers', httpStatus: 200}],
      [{stage: 'chat_sources_verified'}],
      [{stage: 'chat_model', model: 'configured-instance-model'}],
      [{stage: 'chat_done'}],
      [{stage: 'chat_finish', finishReason: 'stop', tokenCount: 8}],
    ]);
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(/原始|当前问题|上一个问题|公开回答|search\.example|content_hash/);
  });

  test.each(['http', 'reader', 'transport'] as const)('awaits durable failure reporting before exposing a %s error to the SDK', async failure => {
    const response = failure === 'http'
      ? new Response('private upstream body', {status: 503})
      : new Response(bytes(chunks([{...item, metadata: {...item.metadata, content_hash: 'c'.repeat(64)}}]) + delta('private generated body') + done),
        {headers: {'content-type': 'text/event-stream'}});
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (failure === 'transport') throw new TypeError('private upstream transport https://search.example.com/internal');
      return response;
    }));
    const order: string[] = [];
    let releaseFailure!: () => void;
    const gate = new Promise<void>(resolve => {releaseFailure = resolve;});
    const observe = vi.fn();
    const onFailure = vi.fn(async () => {order.push('failure-start'); await gate; order.push('failure-finished');});
    const model = publicChatModel('https://search.example.com', [approved], async () => {}, {observe, onFailure});
    const consuming = (async () => {
      try {return await read((await model.doStream({prompt: [{role: 'user', content: [{type: 'text', text: 'private user question'}]}]})).stream);}
      catch (error) {order.push('outward-error'); throw error;}
    })();
    void consuming.catch(() => {});
    try {
      await vi.waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1), {timeout: 1000, interval: 5});
      expect(order).toEqual(['failure-start']);
      releaseFailure();
      await expect(consuming).rejects.toThrow(SAFE_ERROR);
      expect(order).toEqual(['failure-start', 'failure-finished', 'outward-error']);
      expect(onFailure).toHaveBeenCalledTimes(1);
      const events = failure === 'http'
        ? [{stage: 'chat_request'}, {stage: 'chat_headers', httpStatus: 503}, {stage: 'chat_http_error', httpStatus: 503}]
        : failure === 'reader'
          ? [{stage: 'chat_request'}, {stage: 'chat_headers', httpStatus: 200}, {stage: 'chat_sources_rejected'}, {stage: 'chat_model_error'}]
          : [{stage: 'chat_request'}, {stage: 'chat_transport_error'}];
      expect(observe.mock.calls).toEqual(events.map(event => [event]));
      expect(JSON.stringify(observe.mock.calls)).not.toMatch(/private|search\.example|yindongliang|content_hash|canonical_url/);
    } finally {releaseFailure(); await consuming.catch(() => {});}
  });

  test('provider HTTP errors and unapproved stream sources fail safely without copying upstream text', async () => {
    for (const response of [new Response('private upstream marker', {status: 500}),
      new Response(bytes(chunks([{...item, metadata: {...item.metadata, content_hash: 'c'.repeat(64)}}]) + delta('unsafe answer') + done), {headers: {'content-type': 'text/event-stream'}})]) {
      vi.stubGlobal('fetch', vi.fn(async () => response));
      const model = publicChatModel('https://fixture.search.ai.cloudflare.com', [approved], async () => {});
      await expect((async () => {const result = await model.doStream({prompt: [{role: 'user', content: [{type: 'text', text: '问题'}]}]}); return read(result.stream);})()).rejects.toThrow(SAFE_ERROR);
    }
  });

  test('HTTP diagnostics retain only an allowed numeric code and protocol field names from a private error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({errors: [{code: 7004,
      message: 'Invalid messages: private prompt fixture-secret, invalid content at https://private.example/detail',
      request: {privateAccount: 'fixture-account'},
    }], privateTrace: 'fixture-provider-trace'}, {status: 400})));
    const observe = vi.fn();
    const onFailure = vi.fn(async () => {});
    const model = publicChatModel('https://search.example.com', [approved], async () => {}, {observe, onFailure});
    await expect(model.doStream({prompt: [{role: 'user', content: [{type: 'text', text: 'private user prompt'}]}]})).rejects.toThrow(SAFE_ERROR);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls).toEqual([
      [{stage: 'chat_request'}], [{stage: 'chat_headers', httpStatus: 400}],
      [{stage: 'chat_http_error', httpStatus: 400, upstreamCode: 7004, mentionedFields: ['messages', 'content']}],
    ]);
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(/private|fixture|prompt|https:|"request"|"account"|"trace"/i);
  });
});
