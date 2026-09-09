import assert from 'node:assert/strict';
import test from 'node:test';
import {assertComments} from '../scripts/verify-deployment.mjs';

const comments = '<section data-convex-comments data-comment-pathname="/posts/example/" data-pagefind-ignore data-sentry-mask></section>';
const footer = content => `<footer class="book-footer">${content}</footer>`;

test('article comments use canonical pathname and follow footer navigation', () => {
  assertComments(footer(`<a href="/posts/previous/">上一篇</a>${comments}`), true, '/posts/example/');
  assert.throws(() => assertComments(footer(`${comments}<a href="/posts/next/">下一篇</a>`), true, '/posts/example/'), /navigation must precede/);
  assert.throws(() => assertComments(comments + footer(''), true, '/posts/example/'), /inside the Book footer/);
  assert.throws(() => assertComments(footer(comments), true, '/posts/wrong/'), /canonical pathname/);
});

test('indexes never render comment islands and no page loads Giscus', () => {
  assertComments(footer(''), false, '/tags/topic/');
  assert.throws(() => assertComments(footer(comments), false, '/tags/topic/'), /eligibility/);
  assert.throws(() => assertComments('<script src="https://giscus.app/client.js"></script>', false, '/tags/topic/'), /must not be loaded/);
});

test('comments remain outside Pagefind and masked in monitoring', () => {
  assert.throws(() => assertComments(footer(comments.replace(' data-pagefind-ignore', '')), true, '/posts/example/'), /article search/);
  assert.throws(() => assertComments(footer(comments.replace(' data-sentry-mask', '')), true, '/posts/example/'), /masked/);
});
