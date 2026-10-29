import assert from 'node:assert/strict';
import {mkdtemp, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';
import {herouiProAliases, installHeroUiProCssStubs} from '../fixtures/heroui-pro-test-stubs.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const artifacts = '/opt/cursor/artifacts';
await mkdir(artifacts, {recursive: true});
await installHeroUiProCssStubs();
const cacheDir = await mkdtemp(join(tmpdir(), 'text-annotations-vite-'));
const stub = fileURLToPath(new URL('../fixtures/heroui-pro-stub.tsx', import.meta.url));
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [react(), tailwind()],
  optimizeDeps: {entries: ['tests/fixtures/text-annotations.html', 'tests/fixtures/text-annotations-ui.html']},
  resolve: {alias: [
    {find: /^convex\/react$/, replacement: fileURLToPath(new URL('../fixtures/reader-convex.ts', import.meta.url))},
    ...herouiProAliases(stub),
  ]},
  server: {host: '127.0.0.1', port: 0},
  logLevel: 'warn',
});

async function selectText(page, selector, quote) {
  await page.locator(selector).evaluate((element, quote) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const start = node.textContent?.indexOf(quote) ?? -1;
      if (start >= 0) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + quote.length);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      node = walker.nextNode();
    }
    throw new Error(`missing ${quote}`);
  }, quote);
}

let browser;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1100, height: 800}, serviceWorkers: 'block'});
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('/tests/fixtures/text-annotations.html', base).href);
  await page.locator('[data-chat-launcher]').waitFor();

  await selectText(page, '#code', 'npm');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-selection-tools][data-open]').count(), 0, 'Code selections do not open the tools');

  await selectText(page, '#sentence', '统一入口');
  const underlineTool = page.locator('[data-selection-action="underline"]');
  await underlineTool.waitFor();
  await page.locator('[data-chat-launcher][data-selection-active]').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-selection-tools] button')].every(button => getComputedStyle(button).opacity === '1'));
  const fan = await page.locator('[data-selection-tools] button').evaluateAll(buttons => buttons.map(button => {
    const box = button.getBoundingClientRect();
    return {action: button.getAttribute('data-selection-action'), x: box.x, y: box.y, opacity: getComputedStyle(button).opacity};
  }));
  assert.deepEqual(fan.map(item => item.action), ['underline', 'highlight', 'note']);
  assert.ok(fan.every(item => Number(item.opacity) > 0.9), 'Fanned tools are visible');
  assert.deepEqual(await page.locator('[data-selection-tools] button').evaluateAll(buttons => buttons.map(button => button.innerText)), ['', '', '']);
  const launcher = await page.locator('[data-chat-launcher]').boundingBox();
  assert.ok(fan.every(item => item.x < launcher.x + launcher.width), 'Tools stay on the page side of the avatar');
  await page.getByRole('button', {name: '划线'}).hover();
  await page.waitForFunction(() => {
    const tip = document.querySelector('[data-selection-action="underline"] .blog-chat-widget__tooltip');
    const style = tip && getComputedStyle(tip);
    return style && style.visibility === 'visible' && Number(style.opacity) > 0.9;
  });
  await page.screenshot({path: `${artifacts}/selection-tools.png`});

  await page.getByRole('button', {name: '划线'}).click();
  await page.waitForFunction(() => window.__annotations.actions.length === 1);
  const action = await page.evaluate(() => window.__annotations.actions[0]);
  assert.equal(action.type, 'underline');
  assert.equal(action.quote, '统一入口');
  assert.equal(action.pathname, '/docs/vite-plus/');
  assert.equal(action.title, 'Vite+');
  assert.match(action.prefix, /Web /);
  await underlineTool.waitFor({state: 'hidden'});

  await page.evaluate(() => {
    window.__annotations.paint([
      {...window.__annotations.actions[0], id: 'mark-1'},
      {id: 'mark-2', type: 'highlight', quote: '统一入口', prefix: '第二个', suffix: '，用来'},
      {id: 'mark-3', type: 'note', quote: 'Vitest', prefix: '和 ', suffix: ' 放在'},
    ]);
  });
  await page.locator('mark.reader-annotation--underline').waitFor();
  assert.equal(await page.locator('#sentence mark.reader-annotation--underline').innerText(), '统一入口');
  assert.equal(await page.locator('#again mark.reader-annotation--highlight').innerText(), '统一入口');
  assert.equal(await page.locator('#sentence mark.reader-annotation--underline').count(), 1);
  const note = page.locator('mark.reader-annotation--note.reader-annotation--anchor');
  assert.equal(await note.innerText(), 'Vitest');
  assert.equal(await note.getAttribute('id'), 'annotation-mark-3');
  await page.screenshot({path: `${artifacts}/annotation-marks.png`});

  await selectText(page, '#again', '上下文');
  await underlineTool.waitFor();
  await page.keyboard.press('Escape');
  await underlineTool.waitFor({state: 'hidden'});
  assert.equal(await page.evaluate(() => getSelection().isCollapsed), true);

  await selectText(page, '#again', '区分');
  await underlineTool.waitFor();
  await page.locator('#outside').click();
  await underlineTool.waitFor({state: 'hidden'});

  const notes = await context.newPage();
  notes.on('pageerror', error => errors.push(error.message));
  await notes.goto(new URL('/tests/fixtures/text-annotations-ui.html', base).href);
  await notes.getByText('还没有划线、高亮或笔记。').waitFor();
  await notes.evaluate(() => {
    window.__readerFixture.setTextAnnotations([
      {id: 'ann-1', pathname: '/docs/fixture/', title: '本页', type: 'underline', quote: '统一入口', prefix: '', suffix: '', note: null, updatedAt: Date.UTC(2026, 9, 28)},
      {id: 'ann-2', pathname: '/docs/other/', title: '另一篇', type: 'highlight', quote: '高亮一句', prefix: '', suffix: '', note: null, updatedAt: Date.UTC(2026, 9, 27)},
      {id: 'ann-3', pathname: '/docs/fixture/', title: '本页', type: 'note', quote: '写下来', prefix: '', suffix: '', note: '记住测试命令', updatedAt: Date.UTC(2026, 9, 26)},
    ]);
  });
  await notes.getByText('高亮一句').waitFor();
  await notes.getByText('记住测试命令').waitFor();
  await notes.getByRole('radio', {name: '划线'}).click();
  await notes.locator('[data-annotation-filter="underline"]').waitFor();
  assert.equal(await notes.getByText('高亮一句').count(), 0);
  assert.equal(await notes.getByText('写下来').count(), 0);
  await notes.getByRole('link', {name: /统一入口/}).click();
  await notes.waitForFunction(() => document.querySelector('#annotation-ann-1')?.classList.contains('reader-annotation--target'));
  await notes.getByRole('radio', {name: '笔记'}).click();
  await notes.getByText('记住测试命令').waitFor();
  await notes.screenshot({path: `${artifacts}/notes-panel.png`});
  await notes.getByRole('button', {name: '删除这条笔记'}).click();
  await notes.getByText('还没有笔记。').waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  await context.close();
} finally {
  await browser?.close();
  await server.close();
}
