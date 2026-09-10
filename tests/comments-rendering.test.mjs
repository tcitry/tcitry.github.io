import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseFragment} from 'parse5';

const bundle = await build({
  entryPoints: [new URL('../src/components/comments/CommentContent.tsx', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', write: false,
  plugins: [{name: 'rendering-test-dependencies', setup(plugin) {
    // Keep React and the component library on the renderer's shared instance.
    plugin.onResolve({filter: /^[^./]/}, ({path}) => ({path: import.meta.resolve(path), external: true}));
    // This test inspects HTML semantics; browser tests cover image CSS and auth.
    plugin.onLoad({filter: /\.css$/}, () => ({contents: 'export default {};', loader: 'js'}));
  }}],
});
const {default: CommentContent} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function elements(node) { return [...(node.tagName ? [node] : []), ...(node.childNodes ?? []).flatMap(elements)]; }
const comment = (overrides = {}) => ({
  id: 'example', authorName: '读者', body: '评论正文', createdAt: 1_700_000_000_000,
  canDelete: false, deleted: false, likeCount: 0, likedByMe: false, images: [], ...overrides,
});
const render = (value, parentLoaded = false) => renderToStaticMarkup(createElement(CommentContent, {comment: value, parentLoaded}));

test('comment bodies, account usernames and reply names cannot introduce markup or executable links', () => {
  const body = '<script>alert(1)</script>\n<img src=x onerror="alert(2)">\n[link](javascript:alert(3))';
  const html = render(comment({authorName: '<img src=x onerror="alert(4)">', body,
    replyTo: {id: 'parent', authorName: '<svg onload="alert(5)">', deleted: false},
  }));
  const tags = elements(parseFragment(html)).map(node => node.tagName);
  assert.ok(!tags.some(tag => ['script', 'img', 'svg', 'a'].includes(tag)), 'Untrusted text must not create elements or links');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /javascript:alert\(3\)/, 'Markdown remains literal text');
  assert.match(html, /回复 &lt;svg/);
});

test('loaded reply parents receive a local anchor while their account names stay escaped', () => {
  const html = render(comment({replyTo: {id: 'parent', authorName: '<img src=x onerror="alert(1)">', deleted: false}}), true);
  const nodes = elements(parseFragment(html));
  const links = nodes.filter(node => node.tagName === 'a');
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].attrs, [{name: 'href', value: '#comment-parent'}]);
  assert.match(html, /回复 &lt;img/);
  assert.equal(nodes.some(node => node.tagName === 'img' || node.attrs.some(attribute => attribute.name.startsWith('on'))), false);
});

test('deleted comments render a tombstone without their body, identity or images', () => {
  const html = render(comment({deleted: true, authorName: '已删除作者的用户名', body: '已删除的私有正文',
    authorImageUrl: 'https://example.invalid/deleted-avatar.png',
    images: [{id: 'deleted-image', url: 'https://example.invalid/deleted-image.png', contentType: 'image/png', size: 10}],
  }));
  assert.match(html, /这条评论已删除，回复仍保留。/);
  assert.match(html, /已删除的评论/);
  assert.doesNotMatch(html, /已删除作者的用户名|已删除的私有正文|example\.invalid/);
  assert.equal(elements(parseFragment(html)).some(node => node.tagName === 'img'), false);
});

test('replies to a deleted parent retain the relationship without exposing the old author', () => {
  const value = comment({replyTo: {id: 'parent', authorName: '已删除父评论的作者', deleted: true}});
  for (const parentLoaded of [false, true]) {
    const html = render(value, parentLoaded);
    assert.match(html, /回复 已删除的评论/);
    assert.doesNotMatch(html, /已删除父评论的作者/);
    const links = elements(parseFragment(html)).filter(node => node.tagName === 'a');
    assert.equal(links.length, Number(parentLoaded), 'Only a parent present on the page receives an anchor');
    if (parentLoaded) assert.deepEqual(links[0].attrs, [{name: 'href', value: '#comment-parent'}]);
  }
});
