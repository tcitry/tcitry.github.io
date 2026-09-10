import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {request as httpRequest} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {startRetrievalDev} from '../scripts/dev-retrieval.mjs';

const secret = 'test-only-local-retrieval-secret-000000000000';
const document = {key: 'public/article.md', hash: 'current-hash', title: '可信标题',
  url: 'https://yindongliang.com/docs/article/', sourceKind: 'author'};

async function fixture(t, {configuredSecret = secret, chunks = [], createProxy} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'retrieval-server-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await mkdir(path.join(directory, '.generated/ai-search'), {recursive: true});
  await writeFile(path.join(directory, '.dev.vars'), `RAG_BRIDGE_SECRET=${configuredSecret}\n`);
  const referencePath = path.join(directory, '.generated/ai-search/references.json');
  const referenceText = JSON.stringify({documents: [document]});
  await writeFile(referencePath, referenceText);
  const calls = {connections: [], searches: [], disposed: 0};
  const options = {directory, port: 0, createProxy: async options => {
    calls.connections.push(options);
    return createProxy ? createProxy() : {
      env: {BLOG_SEARCH: {async search(input) {calls.searches.push(input); return {chunks};}}},
      async dispose() {calls.disposed++;},
    };
  }};
  const serve = async () => {
    const service = await startRetrievalDev(options);
    t.after(service.close);
    const request = (target = '/api/internal/retrieve', {method = 'POST', token = secret, body = '{"query":"公开文章"}'} = {}) =>
      new Promise((resolve, reject) => {
        // Node's raw request path avoids fetch URL normalization hiding a bypass.
        const req = httpRequest(service.origin, {path: target, method, headers: {
          'content-type': 'application/json', ...(token === null ? {} : {authorization: `Bearer ${token}`}),
          ...(['GET', 'HEAD'].includes(method) ? {} : {'content-length': Buffer.byteLength(body)}),
        }}, res => {
          let text = '';
          res.setEncoding('utf8').on('data', chunk => {text += chunk;});
          res.on('end', () => resolve({status: res.statusCode, headers: res.headers, text}));
        });
        req.on('error', error => reject(Object.assign(error, {target, method})));
        req.end(['GET', 'HEAD'].includes(method) ? undefined : body);
      });
    return {...service, request};
  };
  return {directory, referencePath, referenceText, calls, serve};
}

test('local retrieval refuses absent or weak secrets before listening or connecting', async t => {
  for (const configuredSecret of ['', 'short']) {
    const f = await fixture(t, {configuredSecret});
    await assert.rejects(f.serve, /RAG_BRIDGE_SECRET/);
    assert.equal(f.calls.connections.length, 0);
  }
  const f = await fixture(t);
  await rm(path.join(f.directory, '.dev.vars'));
  await assert.rejects(f.serve, /Missing local .dev.vars/);
});

test('local retrieval exposes only its exact endpoint and POST method', async t => {
  const f = await fixture(t);
  const {request, origin} = await f.serve();
  assert.match(origin, /^http:\/\/127\.0\.0\.1:/);
  for (const target of ['/', '/about/', '/api/chat', '/.dev.vars', '/api/internal/retrieve/',
    '/api/internal/retrieve?query=x', '/api/internal/retrieve/extra', '/api/internal/./retrieve',
    '/api/internal/%72etrieve', '//api/internal/retrieve']) {
    assert.equal((await request(target)).status, 404, target);
  }
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']) {
    const response = await request(undefined, {method});
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, 'POST');
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal(f.calls.connections.length, 0);
});

test('anonymous, wrong-secret and malformed requests never connect to Cloudflare', async t => {
  const f = await fixture(t);
  const {request} = await f.serve();
  for (const token of [null, 'clerk-session-token', 'x'.repeat(secret.length)]) {
    const response = await request(undefined, {token});
    assert.equal(response.status, 401);
    assert.ok(!response.text.includes(secret));
  }
  assert.equal((await request(undefined, {body: '{"query":"ok","userId":"other"}'})).status, 400);
  assert.equal(f.calls.connections.length, 0);
});

test('authorized retrieval reuses the published reference filter and disposes its remote proxy once', async t => {
  const f = await fixture(t, {chunks: [
    {item: {key: document.key, metadata: {content_hash: 'outdated'}}, score: 0.9, text: '过期内容'},
    {item: {key: 'private/secret.md', metadata: {content_hash: document.hash}}, score: 0.9, text: '私有内容'},
    {item: {key: document.key, metadata: {content_hash: document.hash, canonical_url: 'https://attacker.test'}}, score: 0.8, text: '可引用的公开内容'},
  ]});
  const service = await f.serve();
  for (let i = 0; i < 2; i++) {
    const response = await service.request();
    assert.equal(response.status, 200);
    const body = JSON.parse(response.text);
    assert.deepEqual(body.sources, [{id: '1', title: document.title, url: document.url, sourceKind: document.sourceKind}]);
    assert.deepEqual(body.snippets.map(item => item.text), ['可引用的公开内容']);
    assert.doesNotMatch(response.text, /attacker|私有内容|过期内容/);
  }
  assert.deepEqual(f.calls.connections, [{configPath: path.join(f.directory, 'wrangler.jsonc'), envFiles: ['.dev.vars'], remoteBindings: true, persist: false}]);
  assert.equal(f.calls.searches.length, 2);
  assert.equal(await readFile(f.referencePath, 'utf8'), f.referenceText);
  await Promise.all([service.close(), service.close()]);
  assert.equal(f.calls.disposed, 1);
});

test('connection failures return a safe error and allow a later retry without exposing credentials', async t => {
  const f = await fixture(t, {createProxy: async () => {throw new Error(`private-provider-response ${secret}`);}});
  const {request} = await f.serve();
  for (let i = 0; i < 2; i++) {
    const response = await request();
    assert.equal(response.status, 502);
    assert.doesNotMatch(response.text, /private-provider-response|test-only-local/);
  }
  assert.equal(f.calls.connections.length, 2);
});
