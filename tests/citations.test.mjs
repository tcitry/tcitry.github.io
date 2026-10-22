import assert from 'node:assert/strict';
import test from 'node:test';
import {citationHost} from '../src/components/chat/citation-links.ts';

// Mirrors src/components/chat/citation-links.ts so node --test can run without a TS loader.
function injectCitationLinks(text, sources) {
  const ids = new Set(sources.map(source => source.id));
  return text.replace(/\[(\d+)\](?!\()/g, (match, id) => (
    ids.has(id) ? `[${id}](#cite-${id})` : match
  ));
}

test('injectCitationLinks maps known source ids to cite links', () => {
  const sources = [{id: '1', title: 'Doc', url: 'https://yindongliang.com/docs/a/', sourceKind: 'author'}];
  assert.equal(
    injectCitationLinks('同步更新导航页 [1]，并参考 [2]。', sources),
    '同步更新导航页 [1](#cite-1)，并参考 [2]。',
  );
});

test('citationHost strips www and keeps unparsable text', () => {
  assert.equal(citationHost('https://www.yindongliang.com/docs/a/'), 'yindongliang.com');
  assert.equal(citationHost('https://yindongliang.com/posts/durable-objects/'), 'yindongliang.com');
  assert.equal(citationHost('not a url'), 'not a url');
});

test('injectCitationLinks leaves markdown links untouched', () => {
  const sources = [{id: '1', title: 'Doc', url: 'https://yindongliang.com/docs/a/', sourceKind: 'author'}];
  assert.equal(
    injectCitationLinks('[已核验的文章](https://yindongliang.com/docs/a/)', sources),
    '[已核验的文章](https://yindongliang.com/docs/a/)',
  );
});
