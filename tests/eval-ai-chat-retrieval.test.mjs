import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {chatRetrievalOptions, searchRetrievalOptions} from '../src/lib/ai-search-retrieval-options.mjs';

const productionSearch = searchRetrievalOptions();
const productionChat = chatRetrievalOptions(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);

test('shared retrieval defaults match production assistant contract', () => {
  assert.deepEqual(productionSearch, {
    retrieval: {
      retrieval_type: 'hybrid',
      max_num_results: 10,
      match_threshold: 0.4,
      return_on_failure: false,
    },
    query_rewrite: {enabled: false},
    reranking: {enabled: false, model: '@cf/baai/bge-reranker-base'},
    cache: {enabled: true},
  });
  assert.deepEqual(productionChat.retrieval, {
    retrieval_type: 'hybrid',
    max_num_results: 10,
    match_threshold: 0.4,
    return_on_failure: false,
    filters: {content_hash: {$in: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']}},
  });
});

test('eval script uses shared production retrieval options', async () => {
  const script = await readFile(fileURLToPath(new URL('../scripts/eval-ai-chat.mjs', import.meta.url)), 'utf8');
  assert.match(script, /searchRetrievalOptions\(\)/);
  assert.doesNotMatch(script, /retrieval_type:\s*'vector'/);
  assert.doesNotMatch(script, /reranking:\s*\{enabled:\s*false\}/);
});

test('eval script parses AI Search completion SSE chunks events', async () => {
  const script = await readFile(fileURLToPath(new URL('../scripts/eval-ai-chat.mjs', import.meta.url)), 'utf8');
  assert.match(script, /consumeCompletionSseBuffer/);
  assert.match(script, /mapChunkSources/);
  assert.doesNotMatch(script, /data\.event\s*===\s*'chunks'/);
});
