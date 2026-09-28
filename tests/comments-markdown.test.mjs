import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseFragment} from 'parse5';

const utilitiesBundle = await build({
  entryPoints: [new URL('../src/components/comments/comment-markdown.tsx', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', write: false,
  plugins: [{name: 'comment-markdown-test-dependencies', setup(plugin) {
    plugin.onResolve({filter: /^[^./]/}, ({path}) => ({path: import.meta.resolve(path), external: true}));
    plugin.onLoad({filter: /\.css$/}, () => ({contents: 'export default {};', loader: 'js'}));
  }}],
});
const utilities = await import('data:text/javascript;base64,' + Buffer.from(utilitiesBundle.outputFiles[0].text).toString('base64'));

const {
  COMMENT_BODY_MAX_LENGTH,
  commentBodyExcerpt,
  commentMarkdownComponents,
  isCommentBodyOverLimit,
  isExternalCommentHref,
  isSafeCommentHref,
} = utilities;

test('comment markdown helpers reject unsafe hrefs and detect external links', () => {
  assert.equal(isSafeCommentHref('https://example.com/path'), true);
  assert.equal(isSafeCommentHref('/posts/demo/'), true);
  assert.equal(isSafeCommentHref('#comment-abc'), true);
  assert.equal(isSafeCommentHref('javascript:alert(1)'), false);
  assert.equal(isSafeCommentHref('data:text/html,<svg onload=alert(1)>'), false);
  assert.equal(isExternalCommentHref('https://example.com'), true);
  assert.equal(isExternalCommentHref('/posts/demo/'), false);
});

test('comment body excerpts strip markdown while preserving readable text', () => {
  const excerpt = commentBodyExcerpt('**粗体** 与 [链接](https://example.com)\n\n```js\nsecret();\n```');
  assert.match(excerpt, /粗体/);
  assert.match(excerpt, /链接/);
  assert.doesNotMatch(excerpt, /```|https?:\/\/|\*\*/);
});

test('comment body length limit is enforced on the markdown string', () => {
  const body = 'x'.repeat(COMMENT_BODY_MAX_LENGTH);
  assert.equal(isCommentBodyOverLimit(body), false);
  assert.equal(isCommentBodyOverLimit(`${body}!`), true);
});

test('comment markdown renders formatting and safe external links', () => {
  const components = commentMarkdownComponents();
  const Link = components.a;
  const html = renderToStaticMarkup(createElement(Link, {href: 'https://example.com'}, '示例'));
  const nodes = [...parseFragment(html).childNodes];
  assert.equal(nodes[0].tagName, 'a');
  assert.deepEqual(nodes[0].attrs.find(attr => attr.name === 'rel')?.value, 'nofollow noopener noreferrer ugc');
  assert.equal(nodes[0].attrs.find(attr => attr.name === 'target')?.value, '_blank');
});

test('comment markdown blocks javascript links and inline images', () => {
  const components = commentMarkdownComponents();
  const Link = components.a;
  const Image = components.img;
  const unsafe = renderToStaticMarkup(createElement(Link, {href: 'javascript:alert(1)'}, '危险'));
  const image = renderToStaticMarkup(createElement(Image, {src: 'https://evil.invalid/x.png', alt: '附图'}));
  assert.match(unsafe, /<span>危险<\/span>/);
  assert.doesNotMatch(unsafe, /<a\b/);
  assert.match(image, /附图/);
  assert.doesNotMatch(image, /<img\b/);
});
