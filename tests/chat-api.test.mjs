import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAT_GATEWAY, CHAT_MODEL, generationMessages, handleChat, modelText, reasoningFilter, selectSources, validateMessages } from '../worker/chat.mjs';
import { createChatClerk } from './helpers/chat-clerk.mjs';

const clerk = await createChatClerk();
const authHeaders = await clerk.headers();
const encoder = new TextEncoder();
const origin = 'https://yindongliang.com';
const documents = Array.from({ length: 12 }, (_, index) => ({
  key: `public/${index}.md`, hash: `hash-${index}`, title: `公开文章 ${index}`,
  url: `${origin}/posts/${index}/`, sourceKind: index === 0 ? 'ai-assisted' : 'article', updatedAt: '2026-09-01',
}));
const references = { documents };
const question = { messages: [{ role: 'user', content: '如何使用？' }] };
const chunk = (index = 0, changes = {}) => ({
  text: `公开正文 ${index}`, score: 0.8,
  item: { key: documents[index].key, metadata: { content_hash: documents[index].hash } }, ...changes,
});
const data = payload => `data: ${JSON.stringify(payload)}\n\n`;
const delta = text => data({ choices: [{ delta: { content: text } }] });
const complete = text => delta(text) + 'data: [DONE]\n\n';

function byteStream(text, { sizes = [Infinity], close = true, cancel = () => {} } = {}) {
  const bytes = typeof text === 'string' ? encoder.encode(text) : text;
  return new ReadableStream({
    start(controller) {
      for (let offset = 0, index = 0; offset < bytes.length; index++) {
        const end = Math.min(bytes.length, offset + sizes[index % sizes.length]);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      }
      if (close) controller.close();
    }, cancel,
  });
}

function request(body = question, { headers = {}, signal, method = 'POST', raw = false } = {}) {
  return new Request(`${origin}/api/chat`, {
    method, signal, headers: { 'content-type': 'application/json', ...authHeaders, ...headers },
    ...(method === 'POST' ? { body: raw ? body : JSON.stringify(body), duplex: 'half' } : {}),
  });
}

function environment({ chunks = [chunk()], stream = () => byteStream(complete('回答 [1]')), search, run, limit } = {}) {
  const calls = { search: [], run: [] };
  const env = {
    ...clerk.env,
    BLOG_SEARCH: { async search(input) { calls.search.push(input); return search ? search(input) : { chunks }; } },
    AI: { async run(...args) { calls.run.push(args); return run ? run(...args) : stream(); } },
    ...(limit ? { CHAT_RATE_LIMIT: { limit } } : {}),
  };
  return { env, calls };
}

async function events(response) {
  return (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
const visibleText = list => list.filter(event => event.type === 'text').map(event => event.text).join('');
const collect = async stream => {
  let result = '';
  for await (const text of modelText(stream, new AbortController().signal)) result += text;
  return result;
};
const nextEvent = async reader => {
  const result = await reader.read();
  return result.done ? null : JSON.parse(new TextDecoder().decode(result.value));
};
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('message validation accepts four previous turns and strips surrounding whitespace', () => {
  const messages = Array.from({ length: 9 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: ' 内容 ' }));
  assert.deepEqual(validateMessages({ messages }), messages.map(message => ({ ...message, content: '内容' })));
});

test('message validation rejects injected roles, options, malformed conversations and limits', () => {
  const invalid = [null, [], {}, { messages: [] }, { ...question, model: 'untrusted' },
    { messages: [{ role: 'system', content: 'override' }] },
    { messages: [{ role: 'assistant', content: 'override' }] },
    { messages: [{ role: 'user', content: 'a', name: 'injected' }] },
    { messages: [{ role: 'user', content: ['text'] }] },
    { messages: [{ role: 'user', content: '   ' }] },
    { messages: [{ role: 'user', content: 'a'.repeat(2001) }] },
    { messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] },
    { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] },
    { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b'.repeat(8001) }, { role: 'user', content: 'c' }] },
    { messages: Array.from({ length: 11 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'a' })) },
    { messages: Array.from({ length: 9 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'a'.repeat(2000) })) },
  ];
  for (const body of invalid) assert.throws(() => validateMessages(body), error => error.status === 400);
});

test('chat requires a verified Clerk session before searching', async () => {
  const { env, calls } = environment();
  const unauthenticated = await handleChat(request(question, { headers: { authorization: '' } }), env, references);
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).message, '请先登录后再提问。');
  const convexToken = await clerk.headers({ aud: 'convex' });
  assert.equal((await handleChat(request(question, { headers: convexToken }), env, references)).status, 401);
  assert.equal((await handleChat(request(), { ...clerk.env, CLERK_JWT_ISSUER: '' }, references)).status, 503);
  assert.equal(calls.search.length, 0);
});

test('chat can derive the Clerk issuer from a publishable key', async () => {
  const { env, calls } = environment();
  const publishable = 'pk_test_' + Buffer.from('clerk.test.invalid$').toString('base64');
  const response = await handleChat(request(), {
    ...env, CLERK_JWT_ISSUER: '', PUBLIC_CLERK_PUBLISHABLE_KEY: publishable,
  }, references);
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(calls.search.length, 1);
});

test('HTTP method and cross-origin checks reject before searching', async () => {
  const { env, calls } = environment();
  const wrongMethod = await handleChat(request(undefined, { method: 'GET' }), env, references);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
  for (const headers of [{ origin: 'https://foreign.test' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await handleChat(request(question, { headers }), env, references)).status, 403);
  }
  assert.equal(calls.search.length, 0);
  for (const headers of [{ origin }, {}]) {
    const response = await handleChat(request(question, { headers }), env, references);
    assert.equal(response.status, 200);
    await response.text();
  }
});

test('JSON decoding enforces MIME, valid UTF-8, byte length and valid shape', async () => {
  const { env, calls } = environment();
  const cases = [
    [request(question, { headers: { 'content-type': 'text/plain' } }), 415],
    [request('{broken', { raw: true }), 400],
    [request(new Uint8Array([0xff, 0xfe]), { raw: true }), 400],
    [request(null), 400],
    [request(question, { headers: { 'content-length': '32769' } }), 413],
    [request({ messages: [{ role: 'user', content: '中'.repeat(11_000) }] }), 413],
  ];
  for (const [input, status] of cases) {
    const response = await handleChat(input, env, references);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(typeof (await response.json()).message, 'string');
  }
  assert.equal(calls.search.length, 0);
});

test('streamed oversized request cancels its reader even with a misleading Content-Length', async () => {
  let canceled = false;
  const body = byteStream(' '.repeat(32_769), { sizes: [1024], close: false, cancel() { canceled = true; } });
  const { env } = environment();
  const response = await handleChat(request(body, { raw: true, headers: { 'content-length': '10' } }), env, references);
  assert.equal(response.status, 413);
  assert.equal(canceled, true);
});

test('source selection requires both current key and hash and never trusts remote citation metadata', () => {
  const result = selectSources({ chunks: [
    chunk(0, { item: { key: documents[0].key, metadata: { content_hash: 'old-hash' } } }),
    chunk(0, { item: { key: 'withdrawn.md', metadata: { content_hash: documents[0].hash } } }),
    chunk(0, { item: { key: documents[0].key } }),
    chunk(0, { text: ' ', score: 1 }), chunk(0, { score: NaN }), chunk(0, { score: 0.39 }),
    chunk(0, { item: { key: documents[0].key, metadata: { content_hash: documents[0].hash, title: 'fake', url: 'https://foreign.test' } } }),
    chunk(0, { text: '第二片段' }),
  ] }, references);
  assert.deepEqual(result.sources, [{ id: '1', title: documents[0].title, url: documents[0].url, sourceKind: 'ai-assisted' }]);
  assert.equal(result.snippets.length, 2);
  assert.equal(result.snippets[1].source, '1');
  assert.equal(result.snippets[0].updatedAt, documents[0].updatedAt);
  assert.doesNotMatch(JSON.stringify(result), /old-hash|withdrawn|fake|foreign/);
});

test('retrieval selection caps candidate scan, source count, snippet and total context size', () => {
  const cappedSources = selectSources({ chunks: documents.map((_, index) => chunk(index)) }, references);
  assert.equal(cappedSources.sources.length, 5);
  const cappedCandidates = selectSources({ chunks: [...Array.from({ length: 10 }, () => chunk(0, { score: 0 })), chunk(1)] }, references);
  assert.equal(cappedCandidates.sources.length, 0);
  const cappedText = selectSources({ chunks: documents.map((_, index) => chunk(index, { text: '文'.repeat(5000) })) }, references);
  assert.equal(cappedText.snippets.reduce((total, item) => total + item.text.length, 0), 14_000);
  assert.ok(cappedText.snippets.every(item => item.text.length <= 4000));
});

test('no results and stale or withdrawn results refuse without calling a generation model', async () => {
  for (const chunks of [[], [chunk(0, { item: { key: documents[0].key, metadata: { content_hash: 'old' } } })], [chunk(0, { item: { key: 'deleted', metadata: { content_hash: documents[0].hash } } })]]) {
    const { env, calls } = environment({ chunks });
    const list = await events(await handleChat(request(), env, references));
    assert.deepEqual(list[0], { type: 'sources', sources: [] });
    assert.match(visibleText(list), /暂未找到足够依据/);
    assert.equal(list.at(-1).type, 'done');
    assert.equal(calls.run.length, 0);
  }
});

test('chat uses fixed model and sole Gateway and passes only current selected snippets', async () => {
  const { env, calls } = environment();
  const response = await handleChat(request(), env, references);
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
  const list = await events(response);
  assert.equal(visibleText(list), '回答 [1]');
  assert.equal(list.at(-1).type, 'done');
  const [model, input, options] = calls.run[0];
  assert.equal(model, CHAT_MODEL);
  assert.equal(CHAT_MODEL, '@cf/qwen/qwen3-30b-a3b-fp8');
  assert.deepEqual(options, { gateway: { id: CHAT_GATEWAY, skipCache: true, metadata: { feature: 'blog-chat', phase: 'generation' } } });
  assert.equal(CHAT_GATEWAY, 'tcitry-blog-chat');
  assert.equal(input.stream, true);
  assert.equal(input.max_tokens, 2048);
  assert.match(input.messages[0].content, /公开正文 0/);
  assert.match(input.messages[0].content, /ai-assisted/);
  assert.deepEqual(input.messages.slice(1), question.messages);
  assert.deepEqual(calls.search[0].ai_search_options, {
    retrieval: { retrieval_type: 'vector', max_num_results: 8, match_threshold: 0.4, return_on_failure: false },
    query_rewrite: { enabled: false }, reranking: { enabled: false }, cache: { enabled: false },
  });
});

test('follow-up search includes previous question, excludes previous answer, and retains conversation for generation', async () => {
  const body = { messages: [{ role: 'user', content: '前'.repeat(1500) }, { role: 'assistant', content: '历史答案不能作为检索事实' }, { role: 'user', content: '然后呢？' }] };
  const { env, calls } = environment();
  await events(await handleChat(request(body), env, references));
  assert.equal(calls.search[0].query, `上一个问题：${'前'.repeat(1000)}\n当前问题：然后呢？`);
  assert.deepEqual(calls.run[0][1].messages.slice(1), body.messages);
  assert.equal(generationMessages(body.messages, [])[0].role, 'system');
});

test('SSE decoder handles UTF-8, CRLF, multiline data and network boundaries', async () => {
  const wire = ': keepalive\r\n\r\nevent: message\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"中文😀"}}]}\r\n\r\n'
    + data({ choices: [{ delta: { reasoning_content: '不输出推理' } }] }).replaceAll('\n', '\r\n')
    + complete('继续').replaceAll('\n', '\r\n');
  for (const sizes of [[1], [2, 5, 1, 7], [13]]) assert.equal(await collect(byteStream(wire, { sizes })), '中文😀继续');
});

test('SSE errors, malformed JSON, truncated connection and output limit never report completion', async () => {
  const wires = [delta('部分答案'), 'data: not-json\n\n', delta('部分答案') + data({ choices: [{ delta: {}, finish_reason: 'length' }] }),
    'data: ' + 'x'.repeat(65_537), data({ error: { message: 'secret-provider-error', code: 500 } })];
  for (const wire of wires) {
    const { env } = environment({ stream: () => byteStream(wire) });
    const list = await events(await handleChat(request(), env, references));
    assert.equal(list.at(-1).type, 'error');
    assert.equal(list.some(event => event.type === 'done'), false);
    assert.doesNotMatch(JSON.stringify(list), /secret-provider-error/);
  }
});

test('explicit end marker disposes an upstream reader without waiting for socket EOF', async () => {
  let canceled = false;
  assert.equal(await collect(byteStream(complete('完成'), { close: false, cancel() { canceled = true; } })), '完成');
  assert.equal(canceled, true);
});

test('reasoning filter hides complete, split and unclosed think blocks', () => {
  const filter = reasoningFilter();
  const wire = '之前<think>内部推理</think>答案<think>更多秘密</think>结束';
  assert.equal([...wire].map(character => filter(character)).join('') + filter('', true), '之前答案结束');
  const unclosed = reasoningFilter();
  assert.equal(unclosed('可见<th') + unclosed('ink>不能外泄</thi') + unclosed('', true), '可见');
});

test('reasoning in Qwen content is removed across streamed deltas', async () => {
  const wire = ['<th', 'ink>secret', '</thi', 'nk>事实 [1]'].map(delta).join('') + 'data: [DONE]\n\n';
  const { env } = environment({ stream: () => byteStream(wire, { sizes: [3] }) });
  const list = await events(await handleChat(request(), env, references));
  assert.equal(visibleText(list), '事实 [1]');
  assert.equal(list.at(-1).type, 'done');
});

test('empty answers and reasoning-only answers return an error without done', async () => {
  for (const answer of ['', '<think>secret</think>']) {
    const { env } = environment({ stream: () => byteStream(complete(answer)) });
    const list = await events(await handleChat(request(), env, references));
    assert.equal(list.at(-1).type, 'error');
    assert.equal(list.some(event => event.type === 'done'), false);
  }
});

test('visible output cap includes the filter final flush', async () => {
  for (const text of ['a'.repeat(12_001), 'a'.repeat(12_000) + '<thi']) {
    const { env } = environment({ stream: () => byteStream(complete(text)) });
    const list = await events(await handleChat(request(), env, references));
    assert.equal(list.at(-1).type, 'error');
    assert.ok(visibleText(list).length <= 12_000);
  }
});

test('upstream rate limit failures return anonymous retry errors for search and streamed model calls', async () => {
  const failures = [Object.assign(new Error('private upstream detail'), { status: 429 }), new Error('provider returned 429 token=private')];
  for (const error of failures) {
    const { env } = environment({ search: () => { throw error; } });
    const response = await handleChat(request(), env, references);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.doesNotMatch(JSON.stringify(await response.json()), /private|token/);
  }
  for (const code of [429, '429']) {
    const { env } = environment({ stream: () => byteStream(data({ error: { code, message: 'private upstream detail' } })) });
    const list = await events(await handleChat(request(), env, references));
    assert.equal(list.at(-1).type, 'error');
    assert.equal(list.at(-1).retryAfter, 60);
    assert.doesNotMatch(JSON.stringify(list), /private/);
  }
});

test('missing bindings and unexpected generation response are reported without leaking upstream objects', async () => {
  const response = await handleChat(request(), {}, references);
  assert.equal(response.status, 503);
  const { env } = environment({ run: () => ({ token: 'private', response: 'unsupported' }) });
  const list = await events(await handleChat(request(), env, references));
  assert.equal(list.at(-1).type, 'error');
  assert.doesNotMatch(JSON.stringify(list), /private|unsupported/);
});

test('optional Worker limiter blocks before retrieval and hashes the account key', async () => {
  const keys = [];
  const { env, calls } = environment({ limit: async ({ key }) => { keys.push(key); return { success: false }; } });
  const input = request(question, { headers: { 'cf-connecting-ip': '192.0.2.1' } });
  const response = await handleChat(input, env, references);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.match(keys[0], /^[a-f\d]{64}$/);
  assert.doesNotMatch(keys[0], /192\.0\.2\.1|user_test/);
  assert.equal(calls.search.length, 0);
  assert.equal((await handleChat(request(), env, references)).status, 429);
});

test('already aborted request never invokes retrieval', async () => {
  const controller = new AbortController();
  controller.abort();
  const { env, calls } = environment();
  const response = await handleChat(request(question, { signal: controller.signal }), env, references);
  assert.equal(response.status, 504);
  assert.equal(calls.search.length, 0);
});

test('request abort stops a stalled body reader before retrieval', { timeout: 1500 }, async () => {
  const started = deferred();
  const controller = new AbortController();
  let bodyController;
  let canceled = false;
  const body = new ReadableStream({
    start(output) { bodyController = output; },
    pull() { started.resolve(); },
    cancel() { canceled = true; },
  });
  const { env, calls } = environment();
  const responsePromise = handleChat(request(body, { raw: true, signal: controller.signal }), env, references);
  await started.promise;
  controller.abort();
  let timer;
  const response = await Promise.race([responsePromise, new Promise(resolve => { timer = setTimeout(() => resolve(null), 50); })]);
  clearTimeout(timer);
  if (!response) { bodyController.close(); await responsePromise; }
  assert.ok(response, 'abort should finish without the client closing its body stream');
  assert.equal(response.status, 504);
  assert.equal(canceled, true);
  assert.equal(calls.search.length, 0);
});

test('request abort during search returns without waiting for the pending backend', { timeout: 1500 }, async () => {
  const started = deferred();
  const pending = deferred();
  const controller = new AbortController();
  const { env, calls } = environment({ search() { started.resolve(); return pending.promise; } });
  const responsePromise = handleChat(request(question, { signal: controller.signal }), env, references);
  await started.promise;
  controller.abort();
  const response = await responsePromise;
  assert.equal(response.status, 504);
  assert.equal(calls.run.length, 0);
  pending.resolve({ chunks: [] });
});

test('request abort cancels a running model reader and finishes with error instead of done', { timeout: 1500 }, async () => {
  const controller = new AbortController();
  let canceled = false;
  const { env } = environment({ stream: () => byteStream(delta('部分回答'), { close: false, cancel() { canceled = true; } }) });
  const response = await handleChat(request(question, { signal: controller.signal }), env, references);
  const reader = response.body.getReader();
  assert.equal((await nextEvent(reader)).type, 'sources');
  assert.equal((await nextEvent(reader)).type, 'text');
  const next = nextEvent(reader);
  controller.abort();
  assert.equal((await next).type, 'error');
  assert.equal(await nextEvent(reader), null);
  assert.equal(canceled, true);
});

test('canceling the HTTP response stops its pending model reader', { timeout: 1500 }, async () => {
  let canceled = false;
  const { env } = environment({ stream: () => byteStream(delta('部分回答'), { close: false, cancel() { canceled = true; } }) });
  const reader = (await handleChat(request(), env, references)).body.getReader();
  await nextEvent(reader);
  await nextEvent(reader);
  const waiting = reader.read();
  await reader.cancel('client stopped');
  assert.equal((await waiting).done, true);
  assert.equal(canceled, true);
});

test('model stream arriving after cancellation is disposed without becoming visible', { timeout: 1500 }, async () => {
  const started = deferred();
  const pending = deferred();
  const disposed = deferred();
  const controller = new AbortController();
  const { env } = environment({ run() { started.resolve(); return pending.promise; } });
  const reader = (await handleChat(request(question, { signal: controller.signal }), env, references)).body.getReader();
  await nextEvent(reader);
  const next = nextEvent(reader);
  await started.promise;
  controller.abort();
  assert.equal((await next).type, 'error');
  pending.resolve(byteStream(complete('too late'), { close: false, cancel() { disposed.resolve(); } }));
  await disposed.promise;
  assert.equal(await nextEvent(reader), null);
});
