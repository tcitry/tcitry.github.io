import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const commentsCss = readFileSync(new URL('../src/components/comments/comments.css', import.meta.url), 'utf8');
const thread = readFileSync(new URL('../src/components/comments/CommentThread.tsx', import.meta.url), 'utf8')
  + readFileSync(new URL('../src/components/comments/CommentComposer.tsx', import.meta.url), 'utf8');
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
  assert.doesNotMatch(commentsCss, /\.blog-comments__composer[^{]*\{[^}]*border:\s*1px solid/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__composer[^{]*\{[^}]*box-shadow:/);
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

test('signed-in Convex gaps explain likes instead of silently disabling them', () => {
  assert.match(root, /likeAuthPresentation/);
  assert.match(root, /AuthSyncRetry/);
  assert.match(root, /isLoaded/);
  assert.match(root, /authState === 'anonymous'/);
  assert.doesNotMatch(root, /isDisabled=\{Boolean\(userId && \(!isAuthenticated/);
});

test('composer typography relies on HeroUI defaults with minimal blog sizing', () => {
  assert.match(commentsCss, /\.blog-comments__composer[^{]*\{[^}]*font-size:\s*var\(--font-size-smaller/);
  assert.match(commentsCss, /\.blog-comments__editor-author/);
  assert.match(commentsCss, /\.blog-comments__editor \.rich-text-editor__prosemirror > \* \+ \*[^{]*\{[^}]*margin-top:/);
  assert.match(commentsCss, /\.blog-comments__editor \.rich-text-editor__prosemirror p[^{]*\{[^}]*min-height:\s*0/);
  assert.match(commentsCss, /\.blog-comments__editor \.rich-text-editor__prosemirror[^{]*\{[^}]*padding-top:\s*\.5rem/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__editor \.rich-text-editor__toolbar \{/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__editor \.rich-text-editor__toolbar \.button/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__editor-author[^{]*\{[^}]*height:/);
  assert.match(commentsCss, /\.blog-comments__editor \.rich-text-editor__toolbar-button[^{]*\{[^}]*color:\s*var\(--muted\)/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__editor \.rich-text-editor__toolbar-button[^{]*\{[^}]*width:\s*2rem/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__submit \.button[^{]*\{[^}]*font-size:/);
});

test('shared comment image chrome keeps consultation layout and scopes comment-only colors', () => {
  const imagesCss = readFileSync(new URL('../src/components/comments/comment-images.css', import.meta.url), 'utf8');
  assert.match(imagesCss, /\.blog-comments__image-trigger \{[^}]*display:\s*block/);
  assert.match(imagesCss, /\.blog-comments \.blog-comments__image-trigger \{[^}]*--comment-border/);
  assert.match(imagesCss, /\.blog-comments__image-placeholder \{[^}]*background:\s*var\(--surface-secondary\)/);
  assert.match(imagesCss, /\.blog-comments \.blog-comments__image-placeholder \{[^}]*--comment-inset/);
});

test('cancelling the composer discards attached drafts before clearing and can retry a failed discard', () => {
  const cancel = thread.slice(thread.indexOf('async function cancelComposer'), thread.indexOf('const loaded'));
  assert.match(cancel, /setPending\(true\)/);
  assert.match(cancel, /图片暂未移除，请稍后重试/);
  assert.match(cancel, /setImages\(remaining\)/);
  assert.doesNotMatch(cancel, /catch \{\}/);
  assert.match(thread, /async function removeImage[\s\S]*setPending\(true\)/);
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
  assert.doesNotMatch(commentsCss, /\.blog-comments__signin[^{]*\{[^}]*border:\s*1px solid/);
});

test('top-level and nested avatars share the same space above the header', () => {
  assert.match(commentsCss, /--comment-header-y:\s*1rem/);
  assert.match(commentsCss, /\.blog-comments__bubble > \.blog-comments__header[^{]*\{[^}]*padding:\s*var\(--comment-header-y\) 1rem 0/);
  assert.match(commentsCss, /\.blog-comments__item\[data-reply\][^{]*\{[^}]*padding:\s*var\(--comment-header-y\) 1rem \.5rem/);
  assert.match(commentsCss, /\.blog-comments__item\[data-reply\]:first-child > \.blog-comments__tl-line[^{]*\{[^}]*top:\s*var\(--comment-header-y\)/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__bubble > \.blog-comments__header[^{]*\{[^}]*padding:\s*\.5rem 1rem 0/);
});

test('composer uses HeroUI Card structure and native RichTextEditor shell', () => {
  assert.match(thread, /<Card className="blog-comments__composer"/);
  assert.doesNotMatch(thread, /<Card\.Header className="blog-comments__composer-author"/);
  assert.match(thread, /<Card\.Content className="blog-comments__write"/);
  assert.match(thread, /<Card\.Footer className="blog-comments__toolbar"/);
  assert.doesNotMatch(thread, /<Card\.Title className="blog-comments__composer-name"/);
  assert.match(commentsCss, /@import "@heroui\/styles\/components\/card\.css"/);
  assert.doesNotMatch(commentsCss, /\.blog-comments__editor \.rich-text-editor__shell[^{]*\{[^}]*border:\s*0/);
});

test('composer uses HeroUI Pro RichTextEditor with markdown serialization and length guard', () => {
  assert.match(thread, /CommentComposer/);
  assert.match(thread, /COMMENT_BODY_MAX_LENGTH/);
  assert.match(thread, /isCommentBodyOverLimit/);
  assert.match(thread, /blog-comments__char-count--over/);
  assert.match(thread, /@heroui-pro\/react\/rich-text-editor/);
  assert.doesNotMatch(thread, /TextArea/);
});

test('composer separates toolbar and text with a native HeroUI divider', () => {
  assert.match(thread, /<Separator className="blog-comments__editor-divider" \/>/);
  assert.match(commentsCss, /@import "@heroui\/styles\/components\/separator\.css"/);
  assert.match(commentsCss, /\.blog-comments__editor-divider[^{]*\{[^}]*margin:\s*0/);
});

test('composer toolbar buttons use HeroUI ghost icon controls and distinct code block icon', () => {
  assert.match(thread, /variant="ghost" tooltip="粗体"/);
  assert.match(thread, /variant="ghost" tooltip="代码块"/);
  assert.match(thread, /CurlyBrackets/);
  assert.doesNotMatch(thread, /command="codeBlock"[^>]*><Code /);
  assert.match(thread, /placeholder = '写下你的想法…'/);
  assert.match(thread, /text-xs text-muted tabular-nums/);
});

test('composer author avatar and footer actions follow the requested layout', () => {
  assert.match(thread, /<Avatar size="sm" className="blog-comments__editor-author"/);
  assert.match(thread, /aria-label=\{authorName\}/);
  assert.match(thread, /<Tooltip\.Content placement="bottom end">\{authorName\}<\/Tooltip\.Content>/);
  assert.match(commentsCss, /\.blog-comments__editor-author[^{]*\{[^}]*margin-left:\s*auto/);
  const submit = thread.slice(thread.indexOf('className="blog-comments__submit"'), thread.indexOf('</Card.Footer>'));
  const countIndex = submit.indexOf('blog-comments__char-count');
  const cancelIndex = submit.indexOf('blog-comments__cancel');
  const publishIndex = submit.indexOf('blog-comments__publish');
  assert.ok(countIndex > 0 && cancelIndex > countIndex && publishIndex > cancelIndex, 'footer order is counter, cancel, publish');
});
