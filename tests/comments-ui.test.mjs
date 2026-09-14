import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = new URL('../src/components/comments/', import.meta.url);
const read = name => readFileSync(fileURLToPath(new URL(name, root)), 'utf8');

test('comments UI polish keeps dedicated styles and no inline indent', () => {
  const css = read('comments.css');
  const loading = read('CommentQueryLoading.tsx');
  const thread = read('CommentThread.tsx');
  const rootView = read('CommentsRoot.tsx');
  assert.doesNotMatch(loading, /blog-chat__/);
  assert.doesNotMatch(rootView, /AuthLoading|blog-chat__/);
  assert.doesNotMatch(thread, /marginInlineStart/);
  assert.match(thread, /blog-comments__toolbar/);
  assert.match(thread, /data-depth/);
  assert.match(thread, /blog-comments__more/);
  assert.match(css, /--comment-avatar-offset/);
  assert.match(css, /@media \(max-width: 40rem\)/);
  assert.match(css, /blog-comments__skeleton/);
  assert.match(css, /blog-comments__publish\[data-disabled\]/);
  assert.doesNotMatch(css, /blog-chat__/);
  assert.doesNotMatch(css, /margin-left: 2\.75rem/);
});
