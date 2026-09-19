import assert from 'node:assert/strict';
import test from 'node:test';
import {deriveFollowUpSuggestions} from '../src/lib/chat-follow-ups.ts';

test('deriveFollowUpSuggestions returns 2–3 distinct prompts from answer context', () => {
  const prompts = deriveFollowUpSuggestions(
    'Convex 适合哪些应用场景？',
    '## 实时协作\n\nConvex 适合需要实时同步的场景。[1]\n\n## 边缘部署\n\n也可以配合 Workers 使用。',
    [{title: '已核验的 RAG 文章'}],
  );
  assert.ok(prompts.length >= 2 && prompts.length <= 3);
  assert.ok(prompts.every(prompt => prompt.length >= 6));
  assert.equal(new Set(prompts).size, prompts.length);
  assert.ok(prompts.some(prompt => prompt.includes('实时协作')));
  assert.ok(prompts.some(prompt => prompt.includes('已核验的 RAG 文章') || prompt.includes('关键要点')));
});

test('deriveFollowUpSuggestions falls back when answer is short', () => {
  const prompts = deriveFollowUpSuggestions('Git 提交规范？', '先写清楚变更目的。', []);
  assert.ok(prompts.length >= 2 && prompts.length <= 3);
  assert.ok(prompts.every(prompt => typeof prompt === 'string'));
});
