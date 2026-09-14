import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const commentsCss = readFileSync(new URL('../src/components/comments/comments.css', import.meta.url), 'utf8');
const thread = readFileSync(new URL('../src/components/comments/CommentThread.tsx', import.meta.url), 'utf8');
const content = readFileSync(new URL('../src/components/comments/CommentContent.tsx', import.meta.url), 'utf8');
const root = readFileSync(new URL('../src/components/comments/CommentsRoot.tsx', import.meta.url), 'utf8');

test('comment chrome uses DemoSurface / HeroUI tokens instead of Primer greens', () => {
  assert.match(commentsCss, /--comment-canvas:\s*var\(--surface/);
  assert.match(commentsCss, /--comment-inset:\s*var\(--surface-secondary/);
  assert.match(commentsCss, /--comment-fg:\s*var\(--foreground/);
  assert.match(commentsCss, /--comment-muted:\s*var\(--muted/);
  assert.match(commentsCss, /--comment-border:\s*var\(--border/);
  assert.match(commentsCss, /--comment-accent:\s*var\(--accent/);
  assert.match(commentsCss, /--comment-radius:\s*var\(--radius-lg/);
  assert.match(commentsCss, /\.blog-comments__content[^{]*\{[^}]*gap:\s*2rem/);
  assert.match(commentsCss, /\.blog-comments__list[^{]*\{[^}]*gap:\s*1\.5rem/);
  assert.match(commentsCss, /\.blog-comments__tl-line/);
  assert.match(commentsCss, /left:\s*30px/);
  assert.match(commentsCss, /1px dashed/);
  assert.match(commentsCss, /\.blog-comments__write:focus-within/);
  assert.match(commentsCss, /\.blog-comments__write:focus-within[^{]*\{[^}]*box-shadow:\s*0 0 0 2px var\(--comment-accent\)/);
  assert.match(commentsCss, /@media \(forced-colors:\s*active\)[^{]*\{[^}]*\.blog-comments__write:focus-within[^{]*\{[^}]*outline:\s*2px solid Highlight/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__write:focus-within[^{]*\{[^}]*outline-offset:\s*2px/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__write:focus-within[^{]*\{[^}]*box-shadow:\s*0 0 0 2px var\(--comment-accent-subtle\)/);
  assert.match(commentsCss, /\.blog-comments__bubble/);
  assert.match(commentsCss, /\.blog-comments__replies/);
  assert.doesNotMatch(commentsCss, /#1f883d|#238636|#d0d7de|#f6f8fa|#0969da/);
  assert.doesNotMatch(commentsCss, /--comment-primary/);
  assert.doesNotMatch(commentsCss, /blog-comments__empty[^{]*\{[^}]*border-style:\s*dashed/);
  assert.doesNotMatch(commentsCss, /margin-inline-start/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__tabs/);
});

test('composer sits below the thread and keeps the icon toolbar plus HeroUI primary publish', () => {
  const listIndex = thread.indexOf('className="blog-comments__list"');
  const formIndex = thread.indexOf('className="blog-comments__form"');
  const composerIndex = thread.indexOf('className="blog-comments__composer"');
  const publishIndex = thread.indexOf('blog-comments__publish');
  assert.ok(listIndex > 0 && formIndex > listIndex, 'discussion input stays below the thread');
  assert.ok(composerIndex > formIndex);
  assert.ok(publishIndex > composerIndex);
  assert.match(thread, /blog-comments__toolbar/);
  assert.match(thread, /blog-comments__write/);
  assert.match(thread, /aria-label="添加图片"/);
  assert.match(thread, /blog-comments__cancel/);
  assert.match(thread, /blog-comments__char-count/);
  assert.match(thread, />取消</);
  assert.match(thread, /variant="primary"/);
  assert.match(thread, /发布评论/);
  assert.match(root, /登录后发表评论/);
  assert.match(root, /variant="primary"/);
  assert.doesNotMatch(thread, /blog-comments__tabs/);
  assert.doesNotMatch(thread, /marginInlineStart/);
});

test('composer typography uses Book size tokens instead of mixed Primer/HeroUI scales', () => {
  assert.match(commentsCss, /\.blog-comments__composer[^{]*\{[^}]*font-size:\s*var\(--font-size-smaller/);
  assert.match(commentsCss, /\.blog-comments__composer textarea\.textarea[^{]*\{[^}]*padding:\s*1\.125rem 0/);
  assert.match(commentsCss, /\.blog-comments__composer textarea[^{]*\{[^}]*font:\s*inherit/);
  assert.match(commentsCss, /\.blog-comments__composer textarea::placeholder[^{]*\{[^}]*opacity:\s*1/);
  assert.match(commentsCss, /\.blog-comments__char-count[^}]*font-size:\s*var\(--font-size-smallest/);
  assert.match(commentsCss, /\.blog-comments__submit \.button[^{]*\{[^}]*font-size:\s*var\(--font-size-smallest/);
  assert.match(commentsCss, /\.blog-comments__submit \.button[^{]*\{[^}]*font-weight:\s*500/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__submit > span[^{]*\{[^}]*font-size:\s*\.6875rem/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__image-count[^{]*\{[^}]*font-size:\s*\.6875rem/);
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

test('top-level and nested avatars share the same space above the header', () => {
  assert.match(commentsCss, /--comment-header-y:\s*1rem/);
  assert.match(commentsCss, /\.blog-comments__bubble > \.blog-comments__header[^{]*\{[^}]*padding:\s*var\(--comment-header-y\) 1rem 0/);
  assert.match(commentsCss, /\.blog-comments__item\[data-reply\][^{]*\{[^}]*padding:\s*var\(--comment-header-y\) 1rem \.5rem/);
  assert.match(commentsCss, /\.blog-comments__item\[data-reply\]:first-child > \.blog-comments__tl-line[^{]*\{[^}]*top:\s*var\(--comment-header-y\)/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__bubble > \.blog-comments__header[^{]*\{[^}]*padding:\s*\.5rem 1rem 0/);
});

test('composer placeholder and toolbar share one horizontal inset', () => {
  assert.match(commentsCss, /--comment-composer-x:\s*1rem/);
  assert.match(commentsCss, /\.blog-comments__composer[^{]*\{[^}]*padding:\s*1rem var\(--comment-composer-x\)/);
  assert.match(commentsCss, /\.blog-comments__composer textarea\.textarea[^{]*\{[^}]*padding:\s*1\.125rem 0/);
  assert.match(commentsCss, /\.blog-comments__toolbar[^{]*\{[^}]*padding:\s*0/);
  assert.match(commentsCss, /\.blog-comments__uploads \.drop-zone__trigger[^{]*\{[^}]*justify-content:\s*start/);
});

test('composer placeholder is inset and the field ring is focus-only', () => {
  assert.match(commentsCss, /\.blog-comments__composer textarea\.textarea[^{]*\{[^}]*padding:\s*1\.125rem 0/);
  assert.match(commentsCss, /\.blog-comments__write[^{]*\{[^}]*border:\s*0/);
  assert.match(commentsCss, /\.blog-comments__write:focus-within[^{]*\{[^}]*box-shadow:\s*0 0 0 2px var\(--comment-accent\)/);
  assert.match(commentsCss, /@media \(forced-colors:\s*active\)[^{]*\{[^}]*\.blog-comments__write:focus-within[^{]*\{[^}]*outline:\s*2px solid Highlight/);
  assert.match(commentsCss, /\.blog-comments__composer \.textarea:focus[^{]*\{[^}]*box-shadow:\s*none/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__write[^{]*\{[^}]*border:\s*1px solid var\(--field-border/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__write:focus-within[^{]*\{[^}]*outline-offset:\s*2px/);
});
