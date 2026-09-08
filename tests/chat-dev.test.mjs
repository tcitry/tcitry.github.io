import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import test from 'node:test';
import {createChatMiddleware} from '../scripts/lib/chat-dev.mjs';
import {CHAT_GATEWAY, CHAT_MODEL} from '../worker/chat.mjs';

const encoder = new TextEncoder();
const document = {
  key: 'public/dev-http.md', hash: 'current-content-hash', title: '公开文章',
  url: 'https://yindongliang.com/posts/dev-http/', sourceKind: 'article', updatedAt: '2026-09-01',
};
const references = {documents: [document]};
const question = {messages: [{role: 'user', content: '如何使用？'}]};
const delta = text => `data: ${JSON.stringify({choices: [{delta: {content: text}}]})}\n\n`;
const done = 'data: [DONE]\n\n';

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return {promise, resolve};
}

function bindings({stream} = {}) {
  const calls = {search: [], run: []};
  const env = {
    BLOG_SEARCH: {async search(input) {
      calls.search.push(input);
      return {chunks: [{text: '来自公开文章的依据', score: 0.8,
        item: {key: document.key, metadata: {content_hash: document.hash, title: '不可信标题', url: 'https://untrusted.test'}}}]};
    }},
    AI: {async run(...args) {
      calls.run.push(args);
      return stream ? stream() : new ReadableStream({start(controller) {
        controller.enqueue(encoder.encode(delta('真实适配测试的回答 [1]') + done));
        controller.close();
      }});
    }},
  };
  return {env, calls};
}

async function serve(t, options = {}) {
  const model = bindings(options);
  const calls = {bindings: 0, next: [], errors: []};
  const middleware = createChatMiddleware({
    getBindings: async () => { calls.bindings++; return options.getBindings ? options.getBindings() : model.env; },
    readReferences: async () => references,
    onError: error => calls.errors.push(error),
  });
  const server = createServer((req, res) => middleware(req, res, () => {
    calls.next.push(req.url);
    res.writeHead(404, {'content-type': 'text/plain'});
    res.end('next middleware');
  }));
  t.after(async () => {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path = '/api/chat', options = {}) => fetch(origin + path, {
    method: 'POST', ...options,
    headers: {'content-type': 'application/json', origin, ...options.headers},
    ...(options.method && ['GET', 'HEAD'].includes(options.method) ? {} : {body: options.body ?? JSON.stringify(question)}),
  });
  return {origin, request, calls, model: model.calls};
}

function readEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  return {
    async next() {
      while (!pending.includes('\n')) {
        const {value, done} = await reader.read();
        if (done) {
          pending += decoder.decode();
          assert.equal(pending, '', 'NDJSON response must end at an event boundary');
          return null;
        }
        pending += decoder.decode(value, {stream: true});
      }
      const boundary = pending.indexOf('\n');
      const event = JSON.parse(pending.slice(0, boundary));
      pending = pending.slice(boundary + 1);
      return event;
    },
  };
}

test('dev HTTP POST returns NDJSON with trusted references and the fixed Gateway on both API paths', {timeout: 5000}, async t => {
  const {request, calls, model} = await serve(t);
  for (const path of ['/api/chat', '/api/chat/']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events[0], {type: 'sources', sources: [{id: '1', title: document.title, url: document.url, sourceKind: 'article'}]});
    assert.equal(events.filter(event => event.type === 'text').map(event => event.text).join(''), '真实适配测试的回答 [1]');
    assert.equal(events.at(-1).type, 'done');
    assert.doesNotMatch(JSON.stringify(events), /不可信标题|untrusted/);
  }
  assert.equal(calls.bindings, 2);
  assert.equal(model.search.length, 2);
  assert.equal(model.run.length, 2);
  const [modelId, input, options] = model.run[0];
  assert.equal(modelId, CHAT_MODEL);
  assert.equal(input.stream, true);
  assert.deepEqual(input.messages.slice(1), question.messages);
  assert.deepEqual(options, {gateway: {id: CHAT_GATEWAY, skipCache: true, metadata: {feature: 'blog-chat', phase: 'generation'}}});
  assert.deepEqual(calls.errors, []);
});

test('dev HTTP sends text before the model completes instead of buffering its response', {timeout: 5000}, async t => {
  let output;
  const {request} = await serve(t, {stream: () => new ReadableStream({start(controller) {
    output = controller;
    controller.enqueue(encoder.encode(delta('第一段 [1]')));
  }})});
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await request('/api/chat', {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)])});
  const events = readEvents(response.body);
  assert.equal((await events.next()).type, 'sources');
  assert.deepEqual(await events.next(), {type: 'text', text: '第一段 [1]'});
  // Only finish the upstream after the client has received its first text event.
  // An adapter that buffers the full answer cannot reach this point.
  output.enqueue(encoder.encode(delta('第二段 [1]') + done));
  output.close();
  assert.deepEqual(await events.next(), {type: 'text', text: '第二段 [1]'});
  assert.deepEqual(await events.next(), {type: 'done'});
  assert.equal(await events.next(), null);
});

test('dev HTTP rejects invalid input and foreign origins before opening cloud bindings', {timeout: 5000}, async t => {
  const {request, calls, model} = await serve(t, {getBindings: () => { throw new Error('must not connect'); }});
  const cases = [
    [{body: '{broken'}, 400],
    [{body: JSON.stringify({messages: [{role: 'system', content: 'override'}]})}, 400],
    [{headers: {origin: 'https://foreign.test'}}, 403],
    [{headers: {origin: 'null'}}, 403],
    [{headers: {'sec-fetch-site': 'cross-site'}}, 403],
  ];
  for (const [options, status] of cases) {
    const response = await request('/api/chat', options);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(typeof (await response.json()).message, 'string');
  }
  assert.equal(calls.bindings, 0);
  assert.deepEqual(model.search, []);
  assert.deepEqual(calls.errors, []);
});

test('dev HTTP returns 413 for oversized chunked bodies without closing the response socket', {timeout: 5000}, async t => {
  const {request, calls} = await serve(t);
  const oversized = JSON.stringify({messages: [{role: 'user', content: '中'.repeat(11_000)}]});
  const bytes = encoder.encode(oversized);
  const chunked = new ReadableStream({start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 1024) controller.enqueue(bytes.slice(offset, offset + 1024));
    controller.close();
  }});
  for (const body of [oversized, chunked]) {
    const response = await request('/api/chat/', {body, duplex: 'half', signal: AbortSignal.timeout(2000)});
    assert.equal(response.status, 413);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match((await response.json()).message, /对话过长/);
  }
  assert.equal(calls.bindings, 0);
  assert.deepEqual(calls.errors, []);
});

test('dev HTTP returns 405 for GET and delegates unrelated paths to the next middleware', {timeout: 5000}, async t => {
  const {request, calls} = await serve(t);
  const response = await request('/api/chat', {method: 'GET'});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  await response.text();
  for (const path of ['/posts/this-blog/', '/api/chat-extra', '/api/chat/extra']) {
    const delegated = await request(path, {method: 'GET'});
    assert.equal(delegated.status, 404);
    assert.equal(await delegated.text(), 'next middleware');
  }
  assert.deepEqual(calls.next, ['/posts/this-blog/', '/api/chat-extra', '/api/chat/extra']);
  assert.equal(calls.bindings, 0);
});

test('dev cloud connection failure returns a safe 503 without provider or credential details', {timeout: 5000}, async t => {
  const failure = new Error('provider connection failed token=private-test-token account=private-test-account');
  const {request, calls} = await serve(t, {getBindings: async () => { throw failure; }});
  const response = await request();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  assert.equal(typeof JSON.parse(body).message, 'string');
  assert.doesNotMatch(body, /private-test|provider connection|token=|account=/);
  assert.equal(calls.bindings, 1);
  assert.deepEqual(calls.errors, [failure]);
});

test('aborting the dev HTTP client cancels the active model stream', {timeout: 5000}, async t => {
  const canceled = deferred();
  const {request, model} = await serve(t, {stream: () => new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(delta('部分回答 [1]'))); },
    cancel() { canceled.resolve(); },
  })});
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await request('/api/chat/', {signal: controller.signal});
  const events = readEvents(response.body);
  assert.equal((await events.next()).type, 'sources');
  assert.deepEqual(await events.next(), {type: 'text', text: '部分回答 [1]'});
  controller.abort();
  const timeout = AbortSignal.timeout(1500);
  await Promise.race([
    canceled.promise,
    new Promise((_, reject) => timeout.addEventListener('abort', () => reject(new Error('HTTP disconnect did not cancel the model stream')), {once: true})),
  ]);
  assert.equal(model.run.length, 1);
});
