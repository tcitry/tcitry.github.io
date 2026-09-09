import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';

// Real workspace, membership, human inbox and comments UI; all account, database
// and checkout interactions are local fixtures. No external service is contacted.
const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'services-ui-vite-'));
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [react(), tailwind()],
  resolve: {alias: [
    {find: /^convex\/react$/, replacement: fixture('services-convex.tsx')},
    {find: /^convex\/react-clerk$/, replacement: fixture('services-convex.tsx')},
    {find: /^@clerk\/react$/, replacement: fixture('services-clerk.tsx')},
    {find: /^@convex-dev\/agent\/react$/, replacement: fixture('services-agent.tsx')},
  ]},
  define: {
    'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('fixture-public-key'),
    'import.meta.env.PUBLIC_CONVEX_URL': JSON.stringify('https://fixture.convex.cloud'),
  },
  server: {host: '127.0.0.1', port: 0}, logLevel: 'warn',
});
let browser;
const errors = [];
const state = (page) => page.evaluate(() => window.__services.getState());
const switchSession = (page, userId, sessionId) => page.evaluate(({userId, sessionId}) => window.__readerAuth.switchSession(userId, sessionId), {userId, sessionId});
const tab = (page, name) => page.getByRole('radio', {name, exact: true});

try {
  await server.listen();
  const base = new URL(server.resolvedUrls.local[0]);
  browser = await chromium.launch({headless: true});
  for (const width of [973, 640, 375, 320]) {
    const context = await browser.newContext({viewport: {width, height: 998}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(new URL('/tests/fixtures/services-ui.html?view=panel', base).href);
      await page.getByRole('link', {name: '已核验的文章', exact: true}).waitFor();
      const close = page.getByRole('button', {name: '关闭博客助手', exact: true});
      // Establish pointer modality before entering the trigger (React Aria
      // ignores hover caused by keyboard focus or layout movement).
      await page.mouse.move(20, 200);
      await close.hover();
      const tooltip = page.getByRole('tooltip', {name: '关闭博客助手', exact: true});
      await tooltip.waitFor();
      const buttonBox = await close.boundingBox();
      const tooltipBox = await tooltip.boundingBox();
      assert.ok(buttonBox && tooltipBox);
      assert.ok(Math.abs(tooltipBox.y - buttonBox.y - buttonBox.height - 8) <= 1, `Close tooltip stays 8px below its button at ${width}px`);
      assert.ok(Math.abs(tooltipBox.x + tooltipBox.width - buttonBox.x - buttonBox.width) <= 1, `Close tooltip follows the button's right edge at ${width}px`);
      const appearance = await tooltip.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          withinDialog: !!element.closest('dialog'),
          background: style.backgroundColor,
          border: style.borderTopColor,
          visibleAtCenter: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
        };
      });
      assert.equal(appearance.withinDialog, true, 'Tooltip remains in the native modal top layer');
      assert.notEqual(appearance.background, 'rgba(0, 0, 0, 0)', 'Tooltip inherits the panel background token');
      assert.notEqual(appearance.border, 'rgba(0, 0, 0, 0)', 'Tooltip inherits the panel border token');
      assert.equal(appearance.visibleAtCenter, true, 'Tooltip is neither clipped nor covered by the modal');
      assert.ok(tooltipBox.x >= 0 && tooltipBox.x + tooltipBox.width <= width, 'Tooltip stays inside the viewport');
      await page.screenshot({path: join(tmpdir(), `services-close-tooltip-${width}.png`), fullPage: true});
      console.log(`Close tooltip ${width}px: aligned, themed and visible inside the dialog.`);
    } finally {await context.close();}
  }
  for (const width of [1000, 375]) {
    const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(new URL('/tests/fixtures/services-ui.html', base).href);
      await page.getByRole('region', {name: '与 AI 博客助手对话', exact: true}).waitFor();
      for (const name of ['AI 对话', '咨询', '阅读', '会员']) assert.equal(await tab(page, name).count(), 1);
      await tab(page, '会员').click();
      await page.locator('[data-fixture-pricing]').waitFor();
      assert.equal(await page.locator('[data-fixture-pricing]').getAttribute('data-payer'), 'user');
      await page.getByText(/你已拥有 Pro 会员。/).waitFor();
      await page.evaluate(() => window.__services.configure(false));
      await page.getByRole('button', {name: '刷新会员状态'}).click();
      await page.getByText('会员服务尚未开放。', {exact: true}).waitFor();
      assert.equal(await page.locator('[data-fixture-pricing]').count(), 0, 'Unavailable backend hides checkout');
      await page.evaluate(() => window.__services.configure(true));
      await tab(page, '咨询').click();
      await page.getByRole('button', {name: '发起咨询', exact: true}).click();
      await page.getByRole('textbox', {name: '咨询主题'}).fill('第一条私人咨询');
      const raw = '<img src=x onerror="window.__unsafe=true">\n请讨论这个问题。';
      await page.getByRole('textbox', {name: '问题与背景'}).fill(raw);
      await page.getByRole('button', {name: '发起咨询', exact: true}).click();
      await page.getByRole('heading', {name: '第一条私人咨询'}).waitFor();
      await page.getByText(raw, {exact: true}).waitFor();
      assert.equal(await page.locator('[data-consultations-panel] article img').count(), 0, 'Human messages render as inert text');
      assert.equal(await page.evaluate(() => window.__unsafe), undefined);
      await page.getByRole('textbox', {name: '继续咨询'}).fill('补充信息。');
      await page.getByRole('button', {name: '发送消息', exact: true}).click();
      await page.getByText('补充信息。', {exact: true}).waitFor();
      assert.equal(await page.getByRole('textbox', {name: '继续咨询'}).inputValue(), '');
      await page.getByRole('textbox', {name: '继续咨询'}).fill('账号 A 的未保存草稿');
      const initialClients = (await state(page)).clients.length;
      await switchSession(page, 'fixture-b', 'session-b');
      await page.getByText('还没有私人咨询。可以从一个具体问题开始。', {exact: true}).waitFor();
      assert.equal(await page.getByText('第一条私人咨询', {exact: true}).count(), 0);
      assert.equal(await page.getByRole('textbox', {name: '继续咨询'}).count(), 0, 'A different account cannot inherit selected thread or draft');
      let snapshots = (await state(page)).clients;
      assert.equal(snapshots.length, initialClients + 1);
      assert.equal(snapshots.at(-2).closed, true);
      await switchSession(page, 'fixture-a', 'session-a-new');
      await page.getByRole('button', {name: /第一条私人咨询/}).click();
      assert.equal(await page.getByRole('textbox', {name: '继续咨询'}).inputValue(), '');
      await page.getByRole('textbox', {name: '继续咨询'}).fill('同账号旧 session 草稿');
      await switchSession(page, 'fixture-a', 'session-a-newer');
      await page.getByRole('button', {name: /第一条私人咨询/}).waitFor();
      assert.equal(await page.getByRole('textbox', {name: '继续咨询'}).count(), 0, 'New session clears the same account draft');
      await switchSession(page, 'fixture-author', 'session-author');
      await page.getByRole('heading', {name: '咨询收件箱'}).waitFor();
      assert.equal(await page.getByRole('button', {name: '发起咨询', exact: true}).count(), 0);
      await page.getByRole('button', {name: /第一条私人咨询/}).click();
      await page.getByRole('textbox', {name: '回复会员'}).fill('这是博主本人给出的回复。');
      await page.getByRole('button', {name: '发送回复', exact: true}).click();
      await page.getByText('这是博主本人给出的回复。', {exact: true}).waitFor();
      assert.equal(await page.locator('[data-consultations-panel] article strong').last().innerText(), '博主');
      await page.getByText('博主已回复', {exact: true}).waitFor();
      const buttonStyle = await page.getByRole('button', {name: '发送回复', exact: true}).evaluate((button) => {
        const style = getComputedStyle(button);
        return {color: style.color, background: style.backgroundColor, accent: style.getPropertyValue('--accent'), buttonBackground: style.getPropertyValue('--button-bg')};
      });
      assert.notEqual(buttonStyle.background, 'rgba(0, 0, 0, 0)', 'CSS layer order keeps the primary send button readable');
      const overflow = await page.evaluate(() => ({window: innerWidth, document: document.documentElement.scrollWidth, panel: document.querySelector('[data-consultations-panel]').scrollWidth, panelWidth: document.querySelector('[data-consultations-panel]').clientWidth}));
      assert.ok(overflow.document <= overflow.window && overflow.panel <= overflow.panelWidth + 1, `No horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`);
      await page.screenshot({path: join(tmpdir(), `services-consultation-${width}.png`), fullPage: true});
      await page.getByRole('button', {name: '结束咨询', exact: true}).click();
      await page.getByText('这条咨询已结束，对话记录仍然保留。', {exact: true}).waitFor();
      assert.equal(await page.getByRole('textbox', {name: '回复会员'}).count(), 0);
      await switchSession(page, null, null);
      await page.getByRole('heading', {name: '登录后继续'}).waitFor();
      assert.equal(await page.locator('[data-consultations-panel]').count(), 0);
      const actionNames = (await state(page)).writes.map(write => write.name);
      assert.ok(actionNames.includes('consultations:start') && actionNames.includes('consultations:send'));
      assert.ok(!actionNames.some(name => name.startsWith('assistant:')), 'Human consultations never dispatch AI calls');
      console.log(`Services workspace ${width}px: Billing gate, private inbox, safe text, author replies, session isolation and no overflow.`);
    } finally {await context.close();}
  }

  const aiContext = await browser.newContext({viewport: {width: 375, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await aiContext.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  const aiPage = await aiContext.newPage();
  aiPage.setDefaultTimeout(15_000);
  aiPage.on('pageerror', error => errors.push(error.message));
  try {
    await aiPage.goto(new URL('/tests/fixtures/services-ui.html', base).href);
    const ai = aiPage.getByRole('region', {name: '与 AI 博客助手对话', exact: true});
    await ai.getByRole('link', {name: '已核验的文章', exact: true}).waitFor();
    assert.equal(await ai.getByRole('link', {name: '已核验的文章', exact: true}).getAttribute('href'), 'https://yindongliang.com/docs/rag-fixture/');
    assert.equal(await ai.locator('a[href*="example.invalid"]').count(), 0, 'Answer links are restricted to retrieved citations');
    assert.equal(await ai.locator('.blog-chat__answer img').count(), 0, 'Untrusted Markdown images render as text');
    await ai.getByRole('button', {name: '历史', exact: true}).click();
    await ai.getByRole('button', {name: '第二条已保存对话', exact: true}).click();
    await ai.getByText('另一条历史回答。', {exact: true}).waitFor();
    assert.equal(await ai.getByText('已保存的 RAG 问题', {exact: true}).count(), 0, 'Selecting history replaces the transcript');
    await ai.getByRole('button', {name: '新对话', exact: true}).click();
    await ai.getByText('从一个问题开始', {exact: true}).waitFor();
    const composer = ai.getByRole('textbox', {name: '向 AI 博客助手提问', exact: true});
    await composer.fill('新的 AI 问题');
    await ai.getByRole('button', {name: '发送问题', exact: true}).click();
    await ai.getByText('正在生成的部分回答。', {exact: true}).waitFor();
    await ai.getByRole('button', {name: '停止生成', exact: true}).click();
    await ai.getByText(/已停止生成。当前回答可能不完整。/).waitFor();
    await composer.fill('继续生成并保留来源');
    await ai.getByRole('button', {name: '发送问题', exact: true}).click();
    await ai.getByRole('button', {name: '停止生成', exact: true}).waitFor();
    await tab(aiPage, '会员').click();
    await aiPage.locator('[data-membership-panel]').waitFor();
    await aiPage.evaluate(() => window.__services.completeAi());
    await tab(aiPage, 'AI 对话').click();
    await ai.getByRole('link', {name: '已核验的文章', exact: true}).waitFor();
    assert.equal(await ai.getByRole('button', {name: '停止生成', exact: true}).count(), 0, 'Completion updates while the AI tab is hidden');
    assert.equal(await composer.inputValue(), '');
    assert.equal(await ai.locator('a[href*="example.invalid"]').count(), 0);
    const overflow = await aiPage.evaluate(() => ({window: innerWidth, document: document.documentElement.scrollWidth}));
    assert.ok(overflow.document <= overflow.window, 'AI history and citations fit the 375px viewport');
    await aiPage.screenshot({path: join(tmpdir(), 'services-ai-375.png'), fullPage: true});
    await composer.fill('账号 A 的 AI 私人草稿');
    await switchSession(aiPage, 'fixture-b', 'session-b');
    await ai.getByText('仅账号 B 的历史回答。', {exact: true}).waitFor();
    assert.equal(await composer.inputValue(), '');
    assert.equal(await ai.getByText('新的 AI 问题', {exact: true}).count(), 0);
    assert.equal(await ai.getByText('继续生成并保留来源', {exact: true}).count(), 0);
    await composer.fill('账号 B 旧 session 的草稿');
    await switchSession(aiPage, 'fixture-b', 'session-b-new');
    await ai.getByText('仅账号 B 的历史回答。', {exact: true}).waitFor();
    assert.equal(await composer.inputValue(), '');
    const actions = (await state(aiPage)).writes.map(write => write.name);
    for (const name of ['assistant:createConversation', 'assistant:sendMessage', 'assistant:cancel']) assert.ok(actions.includes(name));
    assert.ok(!actions.some(name => name.startsWith('consultations:')), 'AI interactions never send a human consultation');
    console.log('AI workspace: real AgentChat history, send/stop, hidden-tab completion, citation safety, mobile layout and session isolation.');
  } finally {await aiContext.close();}

  const widgetContext = await browser.newContext({viewport: {width: 375, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await widgetContext.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  const widgetPage = await widgetContext.newPage();
  widgetPage.setDefaultTimeout(15_000);
  widgetPage.on('pageerror', error => errors.push(error.message));
  try {
    const widgetURL = new URL('/tests/fixtures/services-ui.html?view=widget', base).href;
    await widgetPage.goto(widgetURL + '&anonymous=true');
    const launcher = widgetPage.locator('[data-chat-launcher]');
    const dialog = widgetPage.locator('#blog-chat-panel');
    await launcher.click();
    await tab(widgetPage, '会员').click();
    await widgetPage.getByRole('heading', {name: '登录后继续'}).waitFor();
    assert.deepEqual(await widgetPage.evaluate(() => JSON.parse(sessionStorage.getItem('blog-assistant-ui'))), {pathname: '/tests/fixtures/services-ui.html', view: 'membership'});
    // Simulate leaving the site for OAuth, then returning as an authenticated user.
    await widgetPage.goto('about:blank');
    await widgetPage.goto(widgetURL);
    await widgetPage.locator('[data-membership-panel]').waitFor();
    assert.equal(await launcher.getAttribute('aria-expanded'), 'true');
    assert.equal(await tab(widgetPage, '会员').getAttribute('aria-checked'), 'true');
    await tab(widgetPage, 'AI 对话').click();
    const composer = widgetPage.getByRole('textbox', {name: '向 AI 博客助手提问', exact: true});
    await composer.fill('这个私人草稿不得写入浏览器持久状态');
    assert.deepEqual(await widgetPage.evaluate(() => JSON.parse(sessionStorage.getItem('blog-assistant-ui'))), {pathname: '/tests/fixtures/services-ui.html', view: 'chat'});
    await switchSession(widgetPage, 'fixture-b', 'session-b');
    await widgetPage.getByText('仅账号 B 的历史回答。', {exact: true}).waitFor();
    assert.equal(await composer.inputValue(), '', 'Restoring UI state never restores another account draft');
    await dialog.evaluate(element => element.close());
    await widgetPage.waitForFunction(() => sessionStorage.getItem('blog-assistant-ui') === null);
    assert.equal(await launcher.getAttribute('aria-expanded'), 'false', 'Native dialog close clears the expanded UI state');
    await launcher.click();
    await widgetPage.keyboard.press('Escape');
    assert.equal(await widgetPage.evaluate(() => sessionStorage.getItem('blog-assistant-ui')), null, 'Escape clears the navigation state');
    await launcher.click();
    await dialog.getByRole('button', {name: '关闭博客助手', exact: true}).click();
    assert.equal(await widgetPage.evaluate(() => sessionStorage.getItem('blog-assistant-ui')), null, 'Explicit close clears the navigation state');
    await widgetPage.reload();
    await launcher.waitFor({state: 'visible'});
    assert.equal(await launcher.getAttribute('aria-expanded'), 'false');
    assert.equal(await dialog.evaluate(element => element.open), false);
    console.log('Assistant callback: native circle restores open/tab after full-page navigation; explicit close clears state; no private drafts persist.');
  } finally {await widgetContext.close();}

  const context = await browser.newContext({viewport: {width: 375, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(new URL('/tests/fixtures/services-ui.html?view=comments&anonymous=true', base).href);
    await page.getByText('登录后查看评论。', {exact: true}).waitFor();
    assert.equal(await page.getByText('登录后可见的初始评论正文', {exact: true}).count(), 0);
    assert.equal(await page.getByRole('textbox').count(), 0);
    assert.equal((await state(page)).requests.filter(request => request.name === 'comments:list').length, 0, 'Anonymous comments do not request any bodies or list');
    await page.screenshot({path: join(tmpdir(), 'services-comments-anonymous-375.png'), fullPage: true});
    await page.getByRole('button', {name: '登录 / 注册', exact: true}).click();
    await page.getByText('登录后可见的初始评论正文', {exact: true}).waitFor();
    await page.getByRole('textbox', {name: '公开昵称'}).fill('本地测试昵称');
    await page.getByRole('textbox', {name: '你的评论'}).fill('<script>window.__unsafe = true</script>');
    await page.getByRole('button', {name: '发布评论', exact: true}).click();
    await page.getByText('<script>window.__unsafe = true</script>', {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => window.__unsafe), undefined);
    await page.getByRole('textbox', {name: '你的评论'}).fill('评论未保存草稿');
    await switchSession(page, 'fixture-b', 'session-b');
    await page.getByRole('textbox', {name: '你的评论'}).waitFor();
    assert.equal(await page.getByRole('textbox', {name: '你的评论'}).inputValue(), '');
    assert.equal(await page.getByRole('textbox', {name: '公开昵称'}).inputValue(), '');
    const before = (await state(page)).requests.filter(request => request.name === 'comments:list').length;
    await switchSession(page, null, null);
    await page.getByText('登录后查看评论。', {exact: true}).waitFor();
    assert.equal(await page.locator('.blog-comments__list').count(), 0);
    assert.equal((await state(page)).requests.filter(request => request.name === 'comments:list').length, before, 'Sign-out hides comments without starting an anonymous list request');
    console.log('Comments: anonymous gate performs no list request; authenticated safe text and drafts clear across sessions.');
  } finally {await context.close();}
  assert.deepEqual(errors, [], 'No browser runtime errors');
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
