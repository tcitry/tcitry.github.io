import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchLegacySources, resolveLegacyRoute } from '../scripts/legacy-content.mjs';

const legacy = JSON.parse(await readFile(new URL('../scripts/legacy-routes.json', import.meta.url), 'utf8'));
const bySource = new Map(legacy.pages.filter(page => page.source).map(page => [page.source, page]));

test('DEV-700 remaps machine-learning docs under Algorithms and Agents', () => {
  assert.ok(bySource.has('docs/Algorithms/机器学习/_index.md'));
  assert.ok(!bySource.has('docs/LLM/机器学习/_index.md'));
  assert.equal(
    bySource.get('docs/Algorithms/机器学习/_index.md').url,
    '/docs/Algorithms/%E6%9C%BA%E5%99%A8%E5%AD%A6%E4%B9%A0/',
  );
  assert.equal(
    bySource.get('docs/Algorithms/机器学习/自然语言处理/One-Hot 编码.md').url,
    '/docs/Algorithms/%E6%9C%BA%E5%99%A8%E5%AD%A6%E4%B9%A0/%E8%87%AA%E7%84%B6%E8%AF%AD%E8%A8%80%E5%A4%84%E7%90%86/One-Hot-%E7%BC%96%E7%A0%81/',
  );
  assert.equal(
    bySource.get('docs/Agents/CoAI.Dev：开源 LLM Gateway 的能力、原理与项目现状.md').url,
    '/docs/Agents/coai-open-source-llm-gateway/',
  );
  assert.ok(!bySource.has('docs/Frontend/前端面试八股集合网站.md'));
});

test('post-migration Blog sources resolve to updated legacy canonical URLs', () => {
  const records = [
    { source: 'docs/Algorithms/机器学习/_index.md', data: {} },
    { source: 'docs/Algorithms/机器学习/自然语言处理/Word2Vec.md', data: {} },
    { source: 'docs/Agents/CoAI.Dev：开源 LLM Gateway 的能力、原理与项目现状.md', data: { slug: 'coai-open-source-llm-gateway' } },
  ];
  const matches = matchLegacySources(records, legacy.pages);
  assert.equal(
    resolveLegacyRoute(records[0], matches.get(records[0].source)).url,
    '/docs/Algorithms/%E6%9C%BA%E5%99%A8%E5%AD%A6%E4%B9%A0/',
  );
  assert.equal(
    resolveLegacyRoute(records[1], matches.get(records[1].source)).url,
    '/docs/Algorithms/%E6%9C%BA%E5%99%A8%E5%AD%A6%E4%B9%A0/%E8%87%AA%E7%84%B6%E8%AF%AD%E8%A8%80%E5%A4%84%E7%90%86/Word2Vec/',
  );
  assert.equal(
    resolveLegacyRoute(records[2], matches.get(records[2].source)).url,
    '/docs/Agents/coai-open-source-llm-gateway/',
  );
});
