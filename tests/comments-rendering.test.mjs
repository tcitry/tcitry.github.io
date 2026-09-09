import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseFragment} from 'parse5';

const bundle = await build({
  entryPoints: [new URL('../src/components/comments/CommentContent.tsx', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', write: false,
});
const {default: CommentContent} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function elements(node) {
  return [...(node.tagName ? [node.tagName] : []), ...(node.childNodes ?? []).flatMap(elements)];
}

test('comment bodies, nicknames and reply names cannot introduce markup or executable links', () => {
  const body = '<script>alert(1)</script>\n<img src=x onerror="alert(2)">\n[link](javascript:alert(3))';
  const html = renderToStaticMarkup(createElement(CommentContent, {comment: {
    id: 'example', authorName: '<img src=x onerror="alert(4)">', body, createdAt: 1_700_000_000_000,
    canDelete: false, replyTo: {id: 'parent', authorName: '<svg onload="alert(5)">'},
  }}));
  const tags = elements(parseFragment(html));
  assert.ok(!tags.some(tag => ['script', 'img', 'svg', 'a'].includes(tag)), 'Untrusted text must not create elements or links');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /javascript:alert\(3\)/, 'Markdown remains literal text');
  assert.match(html, /回复 &lt;svg/);
});
