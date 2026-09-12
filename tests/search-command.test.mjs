import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/components/search/SearchCommand.tsx', import.meta.url), 'utf8');

test('idle commander does not render redundant public-search copy', () => {
  assert.doesNotMatch(source, /搜索公开文章 · 无需登录/);
  assert.match(source, /基于 Cloudflare AI Search/);
  assert.match(source, /基于 Pagefind · 全文搜索/);
});
