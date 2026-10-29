import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('notes tab follows 阅读 and lists text annotations separately from reading marks', () => {
  const workspace = read('src/components/chat/AssistantWorkspace.tsx');
  const views = workspace.slice(workspace.indexOf('const views = ['), workspace.indexOf('] as const;'));
  assert.match(views, /\{id: 'my', label: '我的'\}/);
  assert.match(views, /\{id: 'reading', label: '阅读'\}/);
  assert.match(views, /\{id: 'notes', label: '笔记'\}/);
  assert.match(views, /\{id: 'chat', label: 'AI 对话'\}/);
  assert.match(views, /\{id: 'consult', label: '咨询'\}/);
  assert.ok(views.indexOf("label: '阅读'") < views.indexOf("label: '笔记'"));
  assert.ok(views.indexOf("label: '笔记'") < views.indexOf("label: 'AI 对话'"));
  assert.match(workspace, /<TextAnnotationsPanel pathname=\{pathname\} \/>/);
  assert.match(workspace, /<ReadingMarksPanel \/>/);
  const panel = read('src/components/reader/TextAnnotationsPanel.tsx');
  assert.match(panel, /aria-label="笔记分类"/);
  assert.match(panel, /annotationFilters/);
  assert.match(panel, /api\.reader\.listTextAnnotations/);
  assert.match(panel, /api\.reader\.createTextAnnotation/);
  assert.match(panel, /api\.reader\.deleteTextAnnotation/);
  assert.doesNotMatch(panel, /listReadingMarks|setReadingMark/);
  const tools = read('src/components/chat/BlogChatWidget.astro');
  assert.match(tools, /data-selection-action="underline"/);
  assert.match(tools, /data-selection-action="highlight"/);
  assert.match(tools, /data-selection-action="note"/);
  assert.match(tools, /aria-label="划线"/);
  assert.match(tools, /aria-label="高亮"/);
  assert.match(tools, /aria-label="写笔记"/);
  assert.match(tools, /blog-chat-widget__tooltip" aria-hidden="true">划线/);
  assert.doesNotMatch(tools, /<span>划线<\/span>|<span>高亮<\/span>|<span>写笔记<\/span>/);
  assert.match(read('src/scripts/assistant-ui-state.mjs'), /'notes'/);
  assert.match(read('convex/schema.ts'), /textAnnotations:/);
  assert.doesNotMatch(read('src/components/reader/ReadingMarksPanel.tsx'), /textAnnotations|TextAnnotationsPanel/);
});
