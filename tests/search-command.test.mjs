import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/components/search/SearchCommand.tsx', import.meta.url), 'utf8');

test('search chrome omits redundant Pagefind attribution and idle public-search copy', () => {
  assert.doesNotMatch(source, /搜索公开文章 · 无需登录/);
  assert.doesNotMatch(source, /基于 Pagefind · 全文搜索/);
  assert.match(source, /基于 Cloudflare AI Search/);
  assert.match(source, /activeResult\?\.engine === 'ai-search'/);
});

test('in-flight search shows a centered spinner instead of footer-only copy', () => {
  assert.match(source, /import \{Button, Chip, Spinner\} from '@heroui\/react'/);
  assert.match(source, /<Spinner aria-hidden=\{true\} size="lg" color="accent" \/>/);
  assert.match(source, /data-search-loading/);
  assert.match(source, /queryLoading \? '搜索中' : '正在加载最近更新…'/);
  assert.doesNotMatch(source, /正在搜索…/);
  assert.doesNotMatch(source, /Skeleton/);
  assert.match(source, /showLoading \? ''/);
  assert.doesNotMatch(source, /busy \? '正在加载更多…'/);
  assert.match(source, /没有找到匹配内容，试试其他关键词。/);
  assert.match(source, /暂时无法搜索，请稍后重试。/);
  assert.match(source, /搜索暂时不可用，请重试。/);
  assert.match(source, /完成输入后即可搜索。/);
  assert.match(source, /相关结果正在更新，请稍后再试。/);
});

test('more results load by scrolling and the count stays at the footer end', () => {
  const footer = source.slice(source.indexOf('<Command.Footer'));
  assert.doesNotMatch(source, /['">]加载更多/);
  assert.match(source, /data-search-loading-more/);
  assert.match(source, /<Spinner aria-hidden=\{true\} size="sm" color="accent" \/>/);
  assert.match(source, /正在加载更多…/);
  assert.match(source, /scrollHeight - list\.scrollTop - list\.clientHeight/);
  assert.match(source, /paging\.current/);
  assert.match(footer, /styles\.statusEnd/);
  assert.match(footer, /data-search-ask-ai/);
  assert.match(footer, /用这个问题问 AI/);
  assert.match(source, /找到 \$\{activeResult\?\.total \?\? 0\} 条结果/);
});

test('result kinds are HeroUI chips immediately before the title', () => {
  const row = source.slice(source.indexOf('styles.titleRow'), source.indexOf('styles.excerpt'));
  assert.ok(row.indexOf('<Chip') !== -1 && row.indexOf('<Chip') < row.indexOf('data-search-title'), 'the chip precedes the title');
  assert.match(row, /<Chip size="sm" variant=\{kind\.variant\} color=\{kind\.color\}/);
  assert.match(row, /<Chip\.Label>\{kind\.label\}<\/Chip\.Label>/);
  assert.match(source, /docs: \{label: '文档', color: 'accent'\}/);
  assert.match(source, /posts: \{label: '文章', color: 'success'\}/);
  assert.match(source, /weekly: \{label: '周刊', color: 'warning'\}/);
  assert.match(source, /links: \{label: '链接', color: 'danger'\}/);
  assert.doesNotMatch(row, /sectionNames\[/);
});

test('ask AI stays in the footer and drops the login hint', () => {
  const loading = source.slice(source.indexOf('data-search-loading'), source.indexOf('</Command.List>'));
  const footer = source.slice(source.indexOf('<Command.Footer'));
  assert.doesNotMatch(source, /登录后免费/);
  assert.doesNotMatch(loading, /用这个问题问 AI/);
  assert.match(footer, /data-search-ask-ai/);
  assert.match(footer, /用这个问题问 AI/);
  assert.doesNotMatch(source, /styles\.askHint/);
});

test('search dialog loads HeroUI spinner and chip styles', async () => {
  const css = await readFile(new URL('../src/components/search/search-vendor.css', import.meta.url), 'utf8');
  assert.match(css, /@import "@heroui\/styles\/components\/spinner\.css"/);
  assert.match(css, /@import "@heroui\/styles\/components\/chip\.css"/);
});
