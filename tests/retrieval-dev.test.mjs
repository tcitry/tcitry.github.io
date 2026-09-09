import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import test from 'node:test';
import {createChatMiddleware} from '../scripts/lib/chat-dev.mjs';

test('Astro dev adapter serves the authenticated internal retrieval bridge on both exact paths', async t => {
  const secret = 'test-only-dev-bridge-secret-000000000000000';
  let searches = 0;
  const middleware = createChatMiddleware({
    getBindings: async () => ({RAG_BRIDGE_SECRET: secret, BLOG_SEARCH: {search: async () => { searches++; return {chunks: []}; }}}),
    readReferences: async () => ({documents: []}),
  });
  const server = createServer((req, res) => middleware(req, res, () => {res.writeHead(404); res.end();}));
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  t.after(() => {server.closeAllConnections(); return new Promise(resolve => server.close(resolve));});
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/api/internal/retrieve', '/api/internal/retrieve/']) {
    const response = await fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${secret}`}, body: JSON.stringify({query: '公开文章'})});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {sources: [], snippets: []});
  }
  const unauthorized = await fetch(base + '/api/internal/retrieve', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
  assert.equal(unauthorized.status, 401);
  assert.equal(searches, 2);
  assert.equal((await fetch(base + '/api/internal/retrieve/extra')).status, 404);
});
