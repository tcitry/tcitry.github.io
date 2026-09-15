import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const css = readFileSync(new URL('../src/styles/chat-widget.css', import.meta.url), 'utf8');
const script = readFileSync(new URL('../src/scripts/blog-chat.ts', import.meta.url), 'utf8');

test('edge chevrons drop pointer and HeroUI leftover rings', () => {
  assert.match(css, /:focus-visible:not\(\.blog-chat-widget__expand, \.blog-chat-widget__close, \.assistant-workspace__close\)/,
    'The 4px widget ring must not wrap the edge chevrons');
  assert.match(css, /\[data-focus-visible\]:not\(:focus-visible\)/,
    'HeroUI data-focus-visible without keyboard focus must not paint a box');
  assert.match(css, /\.blog-chat-widget__expand:focus-visible[\s\S]*outline-style:\s*auto/);
  assert.match(css, /\.assistant-workspace__close:focus-visible[\s\S]*outline-style:\s*auto/);
  assert.match(css, /outline-color:\s*var\(--color-link\)/);
  assert.doesNotMatch(css, /\.assistant-workspace__close:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--accent\)/,
    'Do not keep a solid accent box on the collapse handle');
});

test('pointer open does not park keyboard focus on the collapse handle', () => {
  assert.match(script, /function isEdgeChrome/);
  assert.match(script, /restoreOpenerFocus \? visible\('\[aria-label="关闭博客助手"\]'\)/);
  assert.match(script, /!restoreOpenerFocus && isEdgeChrome\(candidate\)/);
  assert.match(script, /clearPointerEdgeFocus/);
  assert.match(script, /queueMicrotask\(clearPointerEdgeFocus\)/);
});
