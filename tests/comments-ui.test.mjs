import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const commentsCss = readFileSync(new URL('../src/components/comments/comments.css', import.meta.url), 'utf8');
const thread = readFileSync(new URL('../src/components/comments/CommentThread.tsx', import.meta.url), 'utf8');
const content = readFileSync(new URL('../src/components/comments/CommentContent.tsx', import.meta.url), 'utf8');
const root = readFileSync(new URL('../src/components/comments/CommentsRoot.tsx', import.meta.url), 'utf8');

test('comment chrome maps Primer / giscus tokens instead of marketing cards', () => {
  assert.match(commentsCss, /--comment-canvas:.*#fff/);
  assert.match(commentsCss, /--comment-inset:.*#f6f8fa/);
  assert.match(commentsCss, /--comment-fg:.*#1F2328/);
  assert.match(commentsCss, /--comment-muted:\s*#656d76/);
  assert.match(commentsCss, /--comment-border:\s*#d0d7de/);
  assert.match(commentsCss, /--comment-primary:\s*#1f883d/);
  assert.match(commentsCss, /--comment-primary:\s*#238636/);
  assert.match(commentsCss, /--comment-accent:\s*var\(--color-link,\s*#0969da\)/);
  assert.match(commentsCss, /\.blog-comments__content[^{]*\{[^}]*gap:\s*2rem/);
  assert.match(commentsCss, /\.blog-comments__list[^{]*\{[^}]*gap:\s*1\.5rem/);
  assert.match(commentsCss, /\.blog-comments__tl-line/);
  assert.match(commentsCss, /left:\s*30px/);
  assert.match(commentsCss, /top:\s*16px/);
  assert.match(commentsCss, /border-bottom:\s*1px dashed/);
  assert.match(commentsCss, /box-shadow:\s*0 0 0 2px var\(--comment-accent\)/);
  assert.match(commentsCss, /height:\s*26px/);
  assert.match(commentsCss, /\.blog-comments__bubble/);
  assert.match(commentsCss, /\.blog-comments__tabs/);
  assert.match(commentsCss, /\.blog-comments__tablist/);
  assert.match(commentsCss, /\.blog-comments__write:focus-within/);
  assert.match(commentsCss, /\.blog-comments__replies/);
  assert.doesNotMatch(commentsCss, /blog-comments__empty[^{]*\{[^}]*border-style:\s*dashed/);
  assert.doesNotMatch(commentsCss, /margin-inline-start/);
});

test('composer sits below the thread and keeps the icon toolbar plus green publish control', () => {
  const listIndex = thread.indexOf('className="blog-comments__list"');
  const formIndex = thread.indexOf('className="blog-comments__form"');
  const composerIndex = thread.indexOf('className="blog-comments__composer"');
  const publishIndex = thread.indexOf('blog-comments__publish');
  assert.ok(listIndex > 0 && formIndex > listIndex, 'giscus data-input-position=bottom: list then composer');
  assert.ok(composerIndex > formIndex);
  assert.ok(publishIndex > composerIndex);
  assert.match(thread, /blog-comments__toolbar/);
  assert.match(thread, /blog-comments__tabs/);
  assert.match(thread, /blog-comments__tablist/);
  assert.match(thread, /blog-comments__write/);
  assert.match(thread, /aria-hidden="true">预览/);
  assert.match(thread, /aria-label="添加图片"/);
  assert.match(thread, /blog-comments__cancel/);
  assert.match(thread, />取消</);
  assert.match(thread, /发布评论/);
  assert.match(commentsCss, /\.blog-comments__publish \{/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__submit > \.button,/);
  assert.match(root, /登录后发表评论/);
  assert.match(root, /blog-comments__publish/);
  assert.doesNotMatch(thread, /marginInlineStart/);
});

test('comment markup uses a discussion header and nested reply rail, not stacked indent cards', () => {
  assert.match(content, /blog-comments__header/);
  assert.match(content, /RelativeTimeFormat/);
  assert.match(thread, /blog-comments__replies/);
  assert.match(commentsCss, /background:\s*var\(--comment-inset\)/);
  assert.match(thread, /renderActions\(comment, replies\.length\)/);
  assert.match(thread, /replyCount != null/);
  assert.match(thread, /条回复/);
  assert.match(thread, /data-reply=""/);
});
