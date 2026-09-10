import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';

// Real AgentChat + HeroUI. Shared service mocks remain read-only; all requests,
// identities, generated messages and delayed sends stay inside this fixture.
const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'agent-chat-prompts-'));
const entry = `
import '@tcitry/astro-book/styles.css';
import '/src/styles/tailwind.css';
import '/src/styles/floating-scrollbars.css';
import React, {StrictMode, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import AgentChat from '/src/components/chat/AgentChat.tsx';
import {ConvexReactClient, ConvexProviderWithClerk} from 'convex/react';
window.__readerAuth.switchSession('fixture-new-reader', 'session-new-reader');
const client = new ConvexReactClient('https://fixture.convex.cloud');
const consumed = [];
let resolveSend;
let sendGate;
function Harness() {
  const [requestedPrompt, setRequestedPrompt] = useState();
  useEffect(() => {window.__promptFixture = {
    request(id, text) {setRequestedPrompt({id, text});},
    getConsumed() {return [...consumed];},
    holdSend() {sendGate = new Promise(resolve => {resolveSend = resolve;});},
    waitForSend() {return sendGate;},
    releaseSend() {resolveSend?.(); sendGate = undefined;},
  };}, []);
  const onPromptConsumed = id => {consumed.push(id); setRequestedPrompt(current => current?.id === id ? undefined : current);};
  return React.createElement(ConvexProviderWithClerk, {client}, React.createElement(AgentChat, {requestedPrompt, onPromptConsumed}));
}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode, null, React.createElement(Harness)));
`;
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [{name: 'isolated-agent-prompt-handoff', enforce: 'pre',
    resolveId(id) {if (id === '/agent-prompts.js') return '\0agent-prompts.js';},
    async load(id) {
      if (id === '\0agent-prompts.js') return entry;
      if (id === fixture('services-convex.tsx')) {
        const source = await readFile(id, 'utf8');
        const marker = "if (name === 'assistant:sendMessage') {";
        assert.equal(source.split(marker).length, 2);
        return source.replace(marker, `${marker}\n      await (window as any).__promptFixture?.waitForSend();`);
      }
    },
    configureServer(server) {server.middlewares.use(async (request, response, next) => {
      if (request.url !== '/') return next();
      response.setHeader('Content-Type', 'text/html');
      response.end(await server.transformIndexHtml('/', '<!doctype html><html data-astro-book lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}#root{height:100dvh}</style></head><body><div id="root"></div><script type="module" src="/agent-prompts.js"></script></body></html>'));
    });},
  }, react(), tailwind()],
  resolve: {alias: [
    {find: /^convex\/react$/, replacement: fixture('services-convex.tsx')},
    {find: /^@clerk\/react$/, replacement: fixture('services-clerk.tsx')},
    {find: /^@convex-dev\/agent\/react$/, replacement: fixture('services-agent.tsx')},
  ]},
  server: {host: '127.0.0.1', port: 0}, logLevel: 'warn',
});
let browser;
const errors = [];
const state = page => page.evaluate(() => window.__services.getState());
const consumed = page => page.evaluate(() => window.__promptFixture.getConsumed());
const requestPrompt = (page, id, text) => page.evaluate(({id, text}) => window.__promptFixture.request(id, text), {id, text});
try {
  await server.listen();
  const base = new URL(server.resolvedUrls.local[0]);
  browser = await chromium.launch({headless: true});
  for (const [width, colorScheme] of [[320, 'light'], [440, 'dark']]) {
    const context = await browser.newContext({viewport: {width, height: 800}, colorScheme, reducedMotion: 'reduce', serviceWorkers: 'block'});
    await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base.href);
    const input = page.getByRole('textbox', {name: '向 AI 博客助手提问', exact: true});
    const suggestion = page.getByRole('button', {name: 'Convex 适合哪些应用场景？', exact: true});
    await suggestion.waitFor();
    await page.screenshot({path: join(tmpdir(), `agent-chat-empty-${width}.png`)});
    await suggestion.click();
    assert.equal(await input.inputValue(), 'Convex 适合哪些应用场景？');
    assert.equal(await input.evaluate(element => document.activeElement === element), true);
    assert.equal((await state(page)).writes.length, 0, 'Choosing an example creates no conversation and sends nothing');
    assert.equal(await suggestion.isDisabled(), true, 'Starter buttons cannot overwrite an edited draft');

    await requestPrompt(page, 'keep', '来自搜索的新问题');
    await page.getByRole('group', {name: '待使用的搜索问题'}).waitFor();
    assert.equal(await input.inputValue(), 'Convex 适合哪些应用场景？');
    assert.deepEqual(await consumed(page), []);
    await page.screenshot({path: join(tmpdir(), `agent-chat-search-draft-${width}.png`)});
    await page.getByRole('button', {name: '保留草稿', exact: true}).click();
    assert.equal(await input.inputValue(), 'Convex 适合哪些应用场景？');
    assert.deepEqual(await consumed(page), ['keep']);

    await requestPrompt(page, 'replace', '替换为这条搜索问题');
    await page.getByRole('button', {name: '使用搜索问题', exact: true}).click();
    assert.equal(await input.inputValue(), '替换为这条搜索问题');
    assert.equal(await input.evaluate(element => document.activeElement === element), true);
    assert.deepEqual(await consumed(page), ['keep', 'replace']);
    await requestPrompt(page, 'replace', '同一个请求不能再次覆盖');
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await input.inputValue(), '替换为这条搜索问题');
    assert.equal(await page.getByRole('group', {name: '待使用的搜索问题'}).count(), 0);
    assert.deepEqual(await consumed(page), ['keep', 'replace']);

    await input.fill('');
    await requestPrompt(page, 'empty', '空草稿直接接收');
    await page.waitForFunction(() => window.__promptFixture.getConsumed().includes('empty'));
    assert.equal(await input.inputValue(), '空草稿直接接收');
    assert.equal((await state(page)).writes.length, 0);
    await requestPrompt(page, 'invalid', '超'.repeat(2001));
    await page.getByRole('alert').waitFor();
    assert.equal(await input.inputValue(), '空草稿直接接收');
    assert.equal((await state(page)).writes.length, 0, 'Invalid imported prompts never replace or submit drafts');

    await page.getByRole('button', {name: '新对话', exact: true}).click();
    await suggestion.waitFor();
    assert.equal(await input.inputValue(), '');
    assert.equal(await input.getAttribute('placeholder'), '向 AI 博客助手提问…');
    await page.getByRole('button', {name: '如何用 Git 管理代码提交？', exact: true}).click();
    assert.equal(await input.inputValue(), '如何用 Git 管理代码提交？', 'Explicitly created empty threads use the same starters');
    assert.equal((await state(page)).writes.filter(item => item.name === 'assistant:sendMessage').length, 0);

    await page.evaluate(() => window.__promptFixture.holdSend());
    await page.getByRole('button', {name: '发送问题', exact: true}).click();
    await page.waitForFunction(() => window.__services.getState().writes.some(item => item.name === 'assistant:sendMessage'));
    await requestPrompt(page, 'during-send', '发送过程中带入的新问题');
    assert.equal(await input.inputValue(), '如何用 Git 管理代码提交？');
    assert.equal(await input.isDisabled(), true);
    await page.evaluate(() => window.__promptFixture.releaseSend());
    await page.waitForFunction(() => window.__promptFixture.getConsumed().includes('during-send'));
    assert.equal(await input.inputValue(), '发送过程中带入的新问题', 'Completion of an earlier send cannot clear a newer imported draft');
    assert.equal((await state(page)).writes.filter(item => item.name === 'assistant:sendMessage').length, 1);
    await page.getByRole('button', {name: '停止生成', exact: true}).click();
    assert.equal(await input.inputValue(), '发送过程中带入的新问题');
    await page.waitForFunction(() => document.querySelector('textarea')?.placeholder === '继续追问，或提出新问题…');
    assert.equal(await page.getByRole('link', {name: /已核验的 RAG 文章/}).count(), 1, 'Existing per-turn source links remain available');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const button of await page.locator('.agent-chat__prompt-actions button, .prompt-suggestion__item').all()) {
      const box = await button.boundingBox();
      if (box) assert.ok(box.x >= 0 && box.x + box.width <= width, 'Prompt controls remain reachable at narrow widths');
    }
    assert.equal(new Set(await consumed(page)).size, (await consumed(page)).length, 'StrictMode and rerenders consume each request once');
    await context.close();
    console.log(`${width}px ${colorScheme}: starters, editable drafts, unique handoff, conflict choices, delayed-send race, continuation, stop and sources passed.`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close(); await server.close(); await rm(cacheDir, {recursive: true, force: true});
}
