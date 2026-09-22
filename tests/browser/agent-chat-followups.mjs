import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'agent-chat-followups-'));
const entry = `
import '@tcitry/astro-book/styles.css';
import '/src/styles/tailwind.css';
import '/src/styles/floating-scrollbars.css';
import React, {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AgentChat from '/src/components/chat/AgentChat.tsx';
import {ConvexReactClient, ConvexProviderWithClerk} from 'convex/react';
window.__readerAuth.switchSession('fixture-a', 'session-a');
const client = new ConvexReactClient('https://fixture.convex.cloud');
createRoot(document.getElementById('root')).render(
  React.createElement(StrictMode, null,
    React.createElement(ConvexProviderWithClerk, {client},
      React.createElement(AgentChat))));
`;
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [{name: 'isolated-agent-followups', enforce: 'pre',
    resolveId(id) {if (id === '/agent-followups.js') return '\0agent-followups.js';},
    load(id) {if (id === '\0agent-followups.js') return entry;},
    configureServer(server) {server.middlewares.use(async (request, response, next) => {
      if (request.url !== '/') return next();
      response.setHeader('Content-Type', 'text/html');
      response.end(await server.transformIndexHtml('/', '<!doctype html><html data-astro-book lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}#root{height:100dvh}</style></head><body><div id="root"></div><script type="module" src="/agent-followups.js"></script></body></html>'));
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
try {
  await server.listen();
  const base = new URL(server.resolvedUrls.local[0]);
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 390, height: 900}, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block'});
  await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base.href);
  const ai = page.getByRole('region', {name: '与 AI 博客助手对话', exact: true});
  const composer = page.getByRole('textbox', {name: '向 AI 博客助手提问', exact: true});
  await ai.getByRole('link', {name: '[1]', exact: true}).waitFor();
  await ai.getByRole('region', {name: '继续追问建议', exact: true}).waitFor();
  const followUps = ai.locator('.agent-chat__follow-ups .prompt-suggestion__item');
  assert.ok((await followUps.count()) >= 2 && (await followUps.count()) <= 3, 'Completed answers expose follow-up suggestions');
  await followUps.first().click();
  assert.ok((await composer.inputValue()).length > 0, 'Follow-up suggestions fill the composer');
  await composer.fill('');
  await ai.getByRole('button', {name: '新对话', exact: true}).click();
  await ai.getByText('从一个问题开始', {exact: true}).waitFor();
  await composer.fill('新的 AI 问题');
  await ai.getByRole('button', {name: '发送问题', exact: true}).click();
  await ai.getByText('正在生成的部分回答。', {exact: true}).waitFor();
  await ai.getByRole('button', {name: '停止生成', exact: true}).click();
  await ai.getByText('已停止生成。当前回答可能不完整。', {exact: true}).waitFor();
  assert.equal(await ai.getByRole('button', {name: '重新生成', exact: true}).count(), 0, 'Canceled turns never offer regenerate');
  await composer.fill('继续生成并保留来源');
  await ai.getByRole('button', {name: '发送问题', exact: true}).click();
  await page.evaluate(() => window.__services.completeAi());
  await ai.getByRole('link', {name: '[1]', exact: true}).waitFor();
  await ai.getByRole('region', {name: '继续追问建议', exact: true}).waitFor();
  await ai.getByRole('button', {name: '新对话', exact: true}).click();
  await composer.fill('触发失败的问题');
  await ai.getByRole('button', {name: '发送问题', exact: true}).click();
  await page.evaluate(() => window.__services.failAi());
  await ai.getByRole('alert').filter({hasText: '回答暂时无法完成'}).waitFor();
  const regenerate = ai.getByRole('button', {name: '重新生成', exact: true});
  await regenerate.waitFor();
  const sendsBefore = (await state(page)).writes.filter(item => item.name === 'assistant:sendMessage').length;
  await regenerate.click();
  await page.waitForFunction(before => window.__services.getState().writes.filter(item => item.name === 'assistant:sendMessage').length > before, sendsBefore);
  await ai.getByText('正在生成的部分回答。', {exact: true}).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
  console.log('AgentChat follow-ups and regenerate passed.');
} finally {
  await browser?.close(); await server.close(); await rm(cacheDir, {recursive: true, force: true});
}
