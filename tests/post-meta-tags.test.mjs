import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const blogCss = readFileSync(new URL('../src/styles/blog.module.css', import.meta.url), 'utf8');

test('post meta tag links use the theme link color for every history state', () => {
  assert.match(
    blogCss,
    /\.site :global\(\.post-meta \.post-meta__tags a:any-link\) \{ @apply text-\[var\(--color-link\)\] underline-offset-2 hover:underline; \}/,
  );
  assert.doesNotMatch(blogCss, /\.post-meta__tags a[^{]*text-inherit/);
});
