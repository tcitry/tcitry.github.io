import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const blogCss = readFileSync(new URL('../src/styles/blog.module.css', import.meta.url), 'utf8');

test('article loose lists reset only the first paragraph top margin inside list items', () => {
  assert.match(
    blogCss,
    /\.book-page \.markdown :is\(ul, ol\) > li > p:first-child:where\(:not\(\[data-book-island\][\s\S]*margin-top:\s*0/,
  );
});
