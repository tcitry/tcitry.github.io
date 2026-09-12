import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
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
  plugins: [{name: 'legacy-reader-negative-control', enforce: 'pre', async load(id) {
    // Optional local snapshot proves that the lifecycle fixture rejects the
    // previous synchronous close without altering the working product source.
    if (process.env.SERVICES_LEGACY_READER_SOURCE && id === join(root, 'src/components/reader/ReaderRoot.tsx')) {
      return await readFile(process.env.SERVICES_LEGACY_READER_SOURCE, 'utf8');
    }
  }}, react(), tailwind()],
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
const scope = process.env.SERVICES_TEST_SCOPE ?? 'all';
assert.ok(['all', 'workspace', 'comments', 'images', 'navigation'].includes(scope), 'SERVICES_TEST_SCOPE must be all, workspace, comments, images or navigation');
const state = (page) => page.evaluate(() => window.__services.getState());
const switchSession = (page, userId, sessionId) => page.evaluate(({userId, sessionId}) => window.__readerAuth.switchSession(userId, sessionId), {userId, sessionId});
const tab = (page, name) => page.locator('.assistant-workspace__switcher').getByRole('radio', {name, exact: true});
const notificationBell = page => page.locator('[data-workspace-notifications]');
const myTab = (page, name) => page.getByRole('radiogroup', {name: '我的内容分类', exact: true}).getByRole('radio', {name, exact: true});
async function assertClientCleanup(page) {
  const {clients, clientLifecycle} = await state(page);
  for (const client of clients.filter(item => item.closed)) {
    assert.equal(client.closeCalls, 1, 'Each released session client closes exactly once');
    const events = clientLifecycle.filter(event => event.clientId === client.id);
    if (events.some(event => event.event === 'setAuth')) {
      assert.ok(events.some(event => event.event === 'clearAuth'), 'Authenticated providers clear auth before releasing their client');
    }
    assert.equal(events.some(event => ['setAuth', 'clearAuth'].includes(event.event) && event.closed), false, 'No auth effect runs against a closed client');
    assert.equal(events.at(-1).event, 'close', 'Client close runs after all provider auth cleanup');
  }
}

let imageBytes;
const imageFixtures = new Map();
const imageFile = (name = 'fixture.png', orientation = 'landscape') => ({name, mimeType: 'image/png', buffer: imageFixtures.get(orientation)});
async function createImageFixtures(browser) {
  const page = await browser.newPage();
  try {
    const images = await page.evaluate(() => ['landscape', 'portrait'].map(orientation => {
      const canvas = document.createElement('canvas');
      canvas.width = orientation === 'landscape' ? 480 : 240;
      canvas.height = orientation === 'landscape' ? 240 : 480;
      const context = canvas.getContext('2d');
      context.fillStyle = '#132a43'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#f0a03c'; context.fillRect(24, 24, canvas.width - 48, canvas.height / 3);
      context.fillStyle = '#4ec9df'; context.beginPath(); context.arc(canvas.width * .65, canvas.height * .68, Math.min(canvas.width, canvas.height) * .22, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#f1f5f9'; context.fillRect(24, canvas.height - 40, canvas.width / 3, 12);
      return {orientation, data: canvas.toDataURL('image/png').split(',')[1]};
    }));
    for (const {orientation, data} of images) imageFixtures.set(orientation, Buffer.from(data, 'base64'));
    imageBytes = imageFixtures.get('landscape');
  } finally {await page.close();}
}

async function installImageRoutes(context, page, base) {
  const network = {uploadRequests: [], imageReads: [], images: new Map(), failNextUpload: false, failNextImageRead: false};
  await context.route('https://fixture.convex.site/comment-images/upload*', async route => {
    const request = route.request();
    const headers = {'Access-Control-Allow-Origin': base.origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
    if (request.method() === 'OPTIONS') {await route.fulfill({status: 204, headers}); return;}
    const purpose = new URL(request.url()).searchParams.get('purpose') ?? 'comment';
    const payload = request.postDataBuffer();
    network.uploadRequests.push({method: request.method(), authorization: request.headers().authorization, contentType: request.headers()['content-type'], size: payload?.length, purpose});
    if (request.headers().authorization !== 'Bearer fixture-session-token') {
      await route.fulfill({status: 401, headers, contentType: 'application/json', body: JSON.stringify({code: 'UNAUTHENTICATED', message: '请先登录。'})}); return;
    }
    if (network.failNextUpload) {
      const failure = typeof network.failNextUpload === 'object' ? network.failNextUpload : {status: 503, code: 'UPLOAD_FAILED'};
      network.failNextUpload = false;
      if (failure.status === 0) await route.abort('failed');
      else await route.fulfill({status: failure.status, headers, contentType: 'application/json', body: JSON.stringify({code: failure.code, message: 'private-provider-detail must never be displayed'})});
      return;
    }
    const imageId = await page.evaluate(({contentType, size, purpose}) => window.__services.createImage({contentType, size, purpose}), {
      contentType: request.headers()['content-type'], size: payload?.length ?? 0, purpose,
    });
    network.images.set(imageId, {bytes: payload, contentType: request.headers()['content-type']});
    await route.fulfill({status: 200, headers, contentType: 'application/json', body: JSON.stringify({imageId})});
  });
  await context.route('https://fixture.convex.site/comment-images/file?*', async route => {
    const request = route.request();
    const headers = {'Access-Control-Allow-Origin': base.origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization'};
    if (request.method() === 'OPTIONS') {await route.fulfill({status: 204, headers}); return;}
    network.imageReads.push({method: request.method(), authorization: request.headers().authorization, imageId: new URL(request.url()).searchParams.get('imageId')});
    if (request.headers().authorization !== 'Bearer fixture-session-token') {
      await route.fulfill({status: 401, headers, contentType: 'application/json', body: JSON.stringify({error: 'Login required'})}); return;
    }
    if (!await page.evaluate(imageId => window.__services.canReadImage(imageId), new URL(request.url()).searchParams.get('imageId'))) {await route.fulfill({status: 403, headers, body: ''}); return;}
    if (network.failNextImageRead) {network.failNextImageRead = false; await route.fulfill({status: 503, headers, body: ''}); return;}
    const file = network.images.get(new URL(request.url()).searchParams.get('imageId'));
    await route.fulfill({status: 200, headers, contentType: file.contentType, body: file.bytes});
  });
  return network;
}

try {
  await server.listen();
  const base = new URL(server.resolvedUrls.local[0]);
  browser = await chromium.launch({headless: true});
  await createImageFixtures(browser);
  if (!['comments', 'navigation'].includes(scope)) {
  if (scope !== 'images') {
  for (const width of [1016, 916, 757, 640, 375, 320]) {
    const context = await browser.newContext({viewport: {width, height: 998}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(new URL('/tests/fixtures/services-ui.html?view=panel', base).href);
      await tab(page, '我的').waitFor();
      assert.equal(await tab(page, '我的').getAttribute('aria-checked'), 'true', 'New assistant sessions begin with My');
      assert.equal(await page.locator('.assistant-workspace__switcher [role=radio]').first().textContent(), '我的');
      await tab(page, 'AI 对话').click();
      await page.getByRole('link', {name: '已核验的文章', exact: true}).waitFor();
      assert.equal(await tab(page, '管理').count(), 0, 'Ordinary members have no author inbox entry');
      await switchSession(page, 'fixture-author', 'session-author');
      await tab(page, '管理').waitFor();
      const navigation = page.locator('.assistant-workspace__switcher');
      const navigationBox = await navigation.boundingBox();
      const accountBox = await navigation.locator('.cl-userButtonTrigger').boundingBox();
      assert.ok(navigationBox && accountBox);
      const bellBox = await notificationBell(page).boundingBox();
      assert.ok(bellBox && bellBox.x + bellBox.width <= accountBox.x);
      assert.equal(accountBox.width, 32); assert.equal(accountBox.height, 32);
      assert.equal(bellBox.width, 32); assert.equal(bellBox.height, 32);
      for (const name of ['AI 对话', '咨询', '我的', '管理']) {
        await tab(page, name).click();
        const itemBox = await tab(page, name).boundingBox();
        assert.ok(itemBox && itemBox.x >= navigationBox.x && itemBox.x + itemBox.width <= bellBox.x + 1,
          `The ${name} author tab is fully visible before the bell and avatar at ${width}px`);
        assert.equal(await tab(page, name).evaluate(element => getComputedStyle(element).fontSize), '14px');
        const nextAccountBox = await navigation.locator('.cl-userButtonTrigger').boundingBox();
        assert.ok(nextAccountBox && Math.abs(nextAccountBox.x - accountBox.x) <= 1, 'Scrolling between tabs keeps the account avatar fixed');
      }
      assert.equal(await navigation.getByRole('radio').count(), 4);
      assert.equal(await tab(page, '消息').count(), 0, 'Notifications are a separate bell, not a top-level tab');
      assert.equal(await navigation.locator('.assistant-workspace__tabs').evaluate(element => getComputedStyle(element).overflowX), 'auto');
      await notificationBell(page).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('region', {name: '消息通知', exact: true}).waitFor();
      assert.equal(await notificationBell(page).getAttribute('aria-pressed'), 'true');
      assert.equal(await navigation.locator('[role="radio"][aria-checked="true"]').count(), 0, 'No tab remains selected while the bell view is active');
      assert.equal(await notificationBell(page).getAttribute('aria-label'), '消息');
      await page.mouse.move(20, 200);
      await notificationBell(page).hover();
      const bellTooltip = page.getByRole('tooltip', {name: '消息', exact: true});
      await bellTooltip.waitFor();
      const bellTooltipBox = await bellTooltip.boundingBox();
      assert.ok(bellTooltipBox && bellTooltipBox.x >= 0 && bellTooltipBox.x + bellTooltipBox.width <= width);
      await tab(page, '管理').click();
      assert.equal(await notificationBell(page).getAttribute('aria-pressed'), 'false');
      assert.ok(Math.abs((await notificationBell(page).boundingBox()).x - bellBox.x) <= 1, 'Bell position remains fixed when changing tabs');
      assert.ok(accountBox.x + accountBox.width <= navigationBox.x + navigationBox.width + 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Four author tabs, notification bell and avatar fit ${width}px`);
      const close = page.getByRole('button', {name: '关闭博客助手', exact: true});
      // Establish pointer modality before entering the trigger (React Aria
      // ignores hover caused by keyboard focus or layout movement).
      await page.mouse.move(20, 200);
      await close.hover();
      const tooltip = page.getByRole('tooltip', {name: '收起侧栏', exact: true});
      await tooltip.waitFor();
      // A warm tooltip opens immediately after moving from the bell. Wait for
      // the overlay's measured placement before checking its final geometry.
      await page.waitForFunction(() => {
        const tip = [...document.querySelectorAll('[role="tooltip"]')].find(element => element.textContent === '收起侧栏');
        const button = document.querySelector('[aria-label="关闭博客助手"]');
        if (!tip || !button) return false;
        const a = tip.getBoundingClientRect(), b = button.getBoundingClientRect();
        return Math.abs(a.x - b.right - 8) <= 1 && Math.abs(a.y + a.height / 2 - b.y - b.height / 2) <= 1;
      });
      const buttonBox = await close.boundingBox();
      const tooltipBox = await tooltip.boundingBox();
      assert.ok(buttonBox && tooltipBox);
      const workspaceBox = await page.locator('.assistant-workspace').boundingBox();
      assert.ok(workspaceBox);
      const edgeBox = await page.getByRole('group', {name: '侧栏操作', exact: true}).boundingBox();
      assert.ok(edgeBox);
      assert.ok(Math.abs((width >= 640 ? edgeBox.x + edgeBox.width : edgeBox.x) - workspaceBox.x) <= 1,
        `Edge actions stay ${width >= 640 ? 'outside' : 'inside'} the sidebar divider at ${width}px`);
      assert.ok(Math.abs(edgeBox.y + edgeBox.height / 2 - workspaceBox.y - workspaceBox.height / 2) <= 1, `Edge actions stay centered on the divider at ${width}px`);
      assert.equal(await close.evaluate(element => !!element.closest('nav')), false, 'Close handle uses no header space');
      assert.ok(Math.abs(tooltipBox.x - buttonBox.x - buttonBox.width - 8) <= 1, `Close tooltip stays 8px inside the sidebar at ${width}px`);
      assert.ok(Math.abs(tooltipBox.y + tooltipBox.height / 2 - buttonBox.y - buttonBox.height / 2) <= 1, `Close tooltip follows the handle center at ${width}px`);
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
      await page.evaluate(() => window.__services.seedPersonal());
      assert.equal(await page.locator('[data-notification-unread]').count(), 0, 'The author cannot see another recipient’s unread badge');
      await switchSession(page, 'fixture-a', 'session-notification-badge');
      await page.locator('[data-notification-unread]').waitFor();
      assert.equal(await notificationBell(page).getAttribute('aria-label'), '消息（有未读）');
      await page.evaluate(() => window.__services.markAllNotificationsRead('fixture-a'));
      await page.locator('[data-notification-unread]').waitFor({state: 'hidden'});
      assert.equal(await notificationBell(page).getAttribute('aria-label'), '消息');
      console.log(`Author header ${width}px: four 14px tabs, keyboard-accessible bell and fixed 32px avatar; both tooltips are visible.`);
    } finally {await context.close();}
  }
  }
  for (const width of [1000, 375]) {
    const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => errors.push(error.message));
    const imageNetwork = await installImageRoutes(context, page, base);
    const notificationReads = [];
    await page.exposeFunction('__recordNotificationRead', id => {notificationReads.push(id);});
    await context.route(new URL('/docs/services-fixture/', base).href, async route => {
      await route.fulfill({response: await route.fetch({url: new URL('/tests/fixtures/services-ui.html?view=comments', base).href})});
    });
    try {
      await page.goto(new URL('/tests/fixtures/services-ui.html', base).href);
      await tab(page, '我的').waitFor();
      assert.equal(await tab(page, '我的').getAttribute('aria-checked'), 'true');
      await tab(page, 'AI 对话').click();
      await page.getByRole('region', {name: '与 AI 博客助手对话', exact: true}).waitFor();
      for (const name of ['AI 对话', '咨询', '我的']) assert.equal(await tab(page, name).count(), 1);
      assert.equal(await tab(page, '消息').count(), 0);
      assert.equal(await notificationBell(page).count(), 1);
      assert.equal(await tab(page, '管理').count(), 0, 'The message inbox is hidden for ordinary members');
      assert.equal(await tab(page, '会员').count(), 0, 'Membership has no separate workspace tab');
      const account = page.getByRole('button', {name: '账户菜单', exact: true});
      const accountMenu = page.getByRole('menu', {name: '账户菜单', exact: true});
      const proItem = accountMenu.getByRole('menuitem', {name: 'Pro 会员 · 管理订阅', exact: true});
      const unavailableItem = accountMenu.getByRole('menuitem', {name: '会员状态暂不可用 · 管理订阅', exact: true});
      await account.click();
      await proItem.waitFor();
      assert.equal(await accountMenu.getByRole('menuitem', {name: '重试会员状态', exact: true}).count(), 0);
      assert.equal(await page.locator('[data-fixture-pricing], [data-membership-panel]').count(), 0, 'Membership status stays in the account menu without a permanent pricing page');
      await proItem.click();
      const profile = page.getByRole('dialog', {name: 'Clerk 账户与订阅（测试）', exact: true});
      await profile.waitFor();
      assert.equal(await profile.evaluate(element => !!element.closest('.blog-clerk-modal')), true, 'The Clerk modal receives the app-configured appearance marker');
      const profileRequests = await page.evaluate(() => window.__servicesClerk.getState().profileRequests);
      assert.equal(profileRequests.length, 1, 'Managing the subscription opens the Clerk account profile once without performing checkout');
      assert.equal(profileRequests[0].userId, 'fixture-a');
      assert.deepEqual(profileRequests[0].options, {__experimental_startPath: '/billing'}, 'The subscription action opens Clerk directly on its Billing route');
      await profile.getByRole('button', {name: '关闭账户弹窗', exact: true}).click();
      await profile.waitFor({state: 'hidden'});
      await page.evaluate(() => window.__services.configure(false));
      await switchSession(page, 'fixture-a', 'session-a-unconfigured');
      await account.click();
      await unavailableItem.waitFor();
      assert.equal(await proItem.count(), 0, 'Missing configuration never presents the previous Pro result as current');
      assert.equal(await accountMenu.getByRole('menuitem', {name: '未开通 Pro 会员 · 管理订阅', exact: true}).count(), 0, 'Missing configuration is not treated as a free account');
      await page.evaluate(() => window.__services.configure(true));
      await page.evaluate(() => window.__services.failNextMembership());
      const membershipReads = (await state(page)).writes.filter(write => write.name === 'membership:getMyMembership').length;
      await accountMenu.getByRole('menuitem', {name: '重试会员状态', exact: true}).click();
      await account.click();
      await unavailableItem.waitFor();
      assert.equal((await state(page)).writes.filter(write => write.name === 'membership:getMyMembership').length, membershipReads + 1, 'The menu retry performs another membership read');
      assert.equal(await accountMenu.getByRole('menuitem', {name: '未开通 Pro 会员 · 管理订阅', exact: true}).count(), 0, 'A failed membership read is not treated as a free account');
      assert.equal(await proItem.count(), 0);
      await accountMenu.getByRole('menuitem', {name: '重试会员状态', exact: true}).click();
      await account.click();
      await proItem.waitFor();
      assert.equal(await accountMenu.getByRole('menuitem', {name: '重试会员状态', exact: true}).count(), 0, 'Successful recovery removes the temporary retry action');
      await switchSession(page, 'fixture-b', 'session-b-membership');
      assert.equal(await accountMenu.count(), 0, 'Changing accounts closes the prior account menu');
      await account.click();
      await accountMenu.getByRole('menuitem', {name: '未开通 Pro 会员 · 管理订阅', exact: true}).waitFor();
      assert.equal(await proItem.count(), 0, 'Switching accounts discards the previous member status');
      await switchSession(page, 'fixture-a', 'session-a-membership');
      await account.click();
      await proItem.waitFor();
      await account.click();
      await tab(page, '咨询').click();
      const consultation = page.locator('[data-consultations-panel]');
      await consultation.getByText('等待博主回复。', {exact: true}).waitFor();
      assert.equal(await consultation.getByText('Pro 会员可发起咨询，等待博主回复。', {exact: true}).count(), 0, 'Pro members are not told they may consult');
      assert.equal(await consultation.getByText('Pro 会员可以发起和继续咨询，已有记录始终可查看。', {exact: true}).count(), 0);
      assert.equal(await consultation.getByRole('button', {name: '开通 Pro', exact: true}).count(), 0);
      assert.equal(await consultation.getByRole('button', {name: '发起咨询', exact: true}).isDisabled(), false, 'Pro members can start a consultation');
      assert.equal(await consultation.getByRole('button', {name: '刷新会员状态', exact: true}).count(), 0, 'Personal consultations have no permanent membership refresh control');
      assert.equal(await consultation.getByRole('button', {name: '重试', exact: true}).count(), 0, 'Successful consultation access checks need no retry control');
      await tab(page, 'AI 对话').click();
      await page.evaluate(() => window.__services.failNextMembership());
      await tab(page, '咨询').click();
      await consultation.getByRole('alert').filter({hasText: '会员状态暂时无法读取，请稍后重试。'}).waitFor();
      assert.equal(await consultation.getByRole('button', {name: '发起咨询', exact: true}).isDisabled(), true, 'A failed access check cannot enable paid consultation creation');
      assert.equal(await consultation.getByRole('button', {name: '开通 Pro', exact: true}).count(), 0, 'A failed access check cannot present a free-account upgrade CTA');
      assert.equal(await consultation.getByText('私人咨询仅 Pro 会员可用。已有记录始终可查看。', {exact: true}).count(), 0, 'A failed membership read is not treated as a free account');
      await consultation.getByRole('button', {name: '重试', exact: true}).click();
      await consultation.getByText('等待博主回复。', {exact: true}).waitFor();
      assert.equal(await consultation.getByRole('button', {name: '发起咨询', exact: true}).isDisabled(), false);
      assert.equal(await consultation.getByRole('button', {name: '重试', exact: true}).count(), 0, 'A successful retry removes its temporary control');
      assert.equal(await consultation.getByRole('alert').count(), 0);
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
      const memberImages = consultation.getByLabel('选择咨询图片', {exact: true});
      await memberImages.setInputFiles(imageFile('member.png'));
      imageNetwork.failNextUpload = true;
      await consultation.getByRole('button', {name: '发送消息', exact: true}).click();
      await consultation.getByText('图片上传未完成，请稍后重试。文字与图片预览已保留。', {exact: true}).waitFor();
      assert.equal(await consultation.getByRole('alert').count(), 1, 'An upload failure has one explanation without a duplicate send error');
      assert.equal(await consultation.getByRole('button', {name: '移除图片 1', exact: true}).count(), 1);
      await page.evaluate(() => window.__services.failNextConsultation());
      await consultation.getByRole('button', {name: '发送消息', exact: true}).click();
      await consultation.getByRole('alert').filter({hasText: '暂时无法完成操作，请稍后重试。'}).waitFor();
      const failedSend = (await state(page)).writes.filter(write => write.name === 'consultations:send').at(-1).args;
      const memberUploadCount = imageNetwork.uploadRequests.length;
      await consultation.getByRole('button', {name: '发送消息', exact: true}).click();
      await consultation.getByRole('button', {name: '查看图片 1', exact: true}).waitFor();
      await consultation.locator('.blog-comments__image-trigger img').first().evaluate(image => image.decode());
      assert.deepEqual(await consultation.locator('.blog-comments__image-trigger img').first().evaluate(image => [image.naturalWidth, image.naturalHeight]), [480, 240]);
      assert.deepEqual((await state(page)).writes.filter(write => write.name === 'consultations:send').at(-1).args, failedSend, 'Retrying an unchanged image message reuses its request id and uploaded image');
      assert.equal(imageNetwork.uploadRequests.length, memberUploadCount);
      assert.equal((await state(page)).messages.at(-1).content, '', 'Members can send an image without body text');
      assert.equal((await state(page)).messages.at(-1).imageIds.length, 1);
      assert.equal(await consultation.getByRole('button', {name: '移除图片 1', exact: true}).count(), 0);
      await page.getByRole('textbox', {name: '继续咨询'}).fill('账号 A 的未保存草稿');
      const initialClients = (await state(page)).clients;
      const activeClientIds = initialClients.filter(client => !client.closed).map(client => client.id);
      await switchSession(page, 'fixture-b', 'session-b');
      await page.getByText('还没有私人咨询。可以从一个具体问题开始。', {exact: true}).waitFor();
      await consultation.getByText('私人咨询仅 Pro 会员可用。已有记录始终可查看。', {exact: true}).waitFor();
      assert.equal(await consultation.getByText('等待博主回复。', {exact: true}).count(), 0);
      assert.equal(await consultation.getByRole('button', {name: '发起咨询', exact: true}).count(), 0, 'Free members see an upgrade action instead of a silently disabled start button');
      const upgrade = consultation.getByRole('button', {name: '开通 Pro', exact: true});
      await upgrade.waitFor();
      assert.equal(await upgrade.isDisabled(), false);
      await upgrade.click();
      const upgradeProfile = page.getByRole('dialog', {name: 'Clerk 账户与订阅（测试）', exact: true});
      await upgradeProfile.waitFor();
      assert.deepEqual((await page.evaluate(() => window.__servicesClerk.getState().profileRequests)).at(-1).options, {__experimental_startPath: '/billing'}, 'Consultation upgrade opens Clerk Billing like the account menu');
      await upgradeProfile.getByRole('button', {name: '关闭账户弹窗', exact: true}).click();
      await upgradeProfile.waitFor({state: 'hidden'});
      assert.equal(await page.getByText('第一条私人咨询', {exact: true}).count(), 0);
      assert.equal(await page.getByRole('textbox', {name: '继续咨询'}).count(), 0, 'A different account cannot inherit selected thread or draft');
      let snapshots = (await state(page)).clients;
      assert.equal(snapshots.length, initialClients.length + activeClientIds.length, 'Every mounted private client is replaced on account change');
      assert.ok(activeClientIds.every(id => snapshots.find(client => client.id === id)?.closed), 'Both the workspace and previously opened My client discard the old account cache');
      assert.ok(snapshots.filter(client => !client.closed).every(client => client.userId === 'fixture-b'));
      await assertClientCleanup(page);
      await switchSession(page, 'fixture-a', 'session-a-new');
      await page.getByRole('button', {name: /第一条私人咨询/}).click();
      assert.equal(await page.getByRole('textbox', {name: '继续咨询'}).inputValue(), '');
      await page.getByRole('textbox', {name: '继续咨询'}).fill('同账号旧 session 草稿');
      await switchSession(page, 'fixture-a', 'session-a-newer');
      await page.getByRole('button', {name: /第一条私人咨询/}).waitFor();
      assert.equal(await page.getByRole('textbox', {name: '继续咨询'}).count(), 0, 'New session clears the same account draft');
      await switchSession(page, 'fixture-author', 'session-author');
      await tab(page, '管理').waitFor();
      await tab(page, '咨询').click();
      await page.getByRole('heading', {name: '与博主交流', exact: true}).waitFor();
      await page.getByText('还没有私人咨询。可以从一个具体问题开始。', {exact: true}).waitFor();
      assert.equal(await page.getByRole('button', {name: /第一条私人咨询/}).count(), 0, 'The author consultation tab lists only the author own consultations');
      assert.equal(await page.locator('[data-consultations-inbox]').count(), 0, 'Personal consultation mode never mounts the author inbox');
      await tab(page, '管理').click();
      const inbox = page.locator('[data-consultations-inbox]');
      await inbox.getByRole('heading', {name: '管理', exact: true}).waitFor();
      assert.equal(await inbox.getByRole('button', {name: '发起咨询', exact: true}).count(), 0);
      await page.getByRole('button', {name: /第一条私人咨询/}).click();
      await page.getByRole('textbox', {name: '回复会员'}).fill('这是博主本人给出的回复。');
      await inbox.getByLabel('选择咨询图片', {exact: true}).setInputFiles(imageFile('author.png', 'portrait'));
      await page.getByRole('button', {name: '发送回复', exact: true}).click();
      await page.getByText('这是博主本人给出的回复。', {exact: true}).waitFor();
      assert.equal(await inbox.locator('article strong').last().innerText(), '你');
      assert.equal((await state(page)).messages.at(-1).imageIds.length, 1, 'Author replies persist their own image attachment');
      assert.ok(imageNetwork.uploadRequests.every(request => request.purpose === 'consultation' && request.authorization === 'Bearer fixture-session-token'), 'Consultation uploads explicitly use their private purpose and session token');
      await inbox.locator('article').last().getByRole('button', {name: '查看图片 1', exact: true}).waitFor();
      await inbox.locator('article').last().locator('img').evaluate(image => image.decode());
      assert.deepEqual(await inbox.locator('article').last().locator('img').evaluate(image => [image.naturalWidth, image.naturalHeight]), [240, 480], 'An author portrait image retains its original dimensions');
      assert.equal(await inbox.getByRole('button', {name: '返回管理列表', exact: true}).count(), 1);
      await page.getByText('博主已回复', {exact: true}).waitFor();
      const buttonStyle = await page.getByRole('button', {name: '发送回复', exact: true}).evaluate((button) => {
        const style = getComputedStyle(button);
        return {color: style.color, background: style.backgroundColor, accent: style.getPropertyValue('--accent'), buttonBackground: style.getPropertyValue('--button-bg')};
      });
      assert.notEqual(buttonStyle.background, 'rgba(0, 0, 0, 0)', 'CSS layer order keeps the primary send button readable');
      const overflow = await page.evaluate(() => ({window: innerWidth, document: document.documentElement.scrollWidth, panel: document.querySelector('[data-consultations-panel]').scrollWidth, panelWidth: document.querySelector('[data-consultations-panel]').clientWidth}));
      assert.ok(overflow.document <= overflow.window && overflow.panel <= overflow.panelWidth + 1, `No horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`);
      await page.screenshot({path: join(tmpdir(), `services-consultation-${width}.png`), fullPage: true});
      await page.getByRole('textbox', {name: '回复会员'}).fill('作者账号未发送的私人回复草稿');
      await inbox.getByLabel('选择咨询图片', {exact: true}).setInputFiles(imageFile('author-unsaved.png'));
      await page.evaluate(() => window.__services.failNextConsultation());
      await inbox.getByRole('button', {name: '发送回复', exact: true}).click();
      await inbox.getByRole('alert').filter({hasText: '暂时无法完成操作，请稍后重试。'}).waitFor();
      const unboundImage = (await state(page)).commentImages.find(image => !image.attached).id;
      await switchSession(page, 'fixture-b', 'session-b-after-author');
      await page.getByRole('heading', {name: '与博主交流', exact: true}).waitFor();
      assert.equal(await tab(page, '咨询').getAttribute('aria-checked'), 'true', 'A non-author switching away from the inbox returns to personal consultations');
      assert.equal(await tab(page, '管理').count(), 0);
      assert.equal(await inbox.count(), 0);
      assert.equal(await page.getByRole('textbox', {name: '回复会员'}).count(), 0);
      assert.equal(await page.getByRole('button', {name: '移除图片 1', exact: true}).count(), 0, 'The next account never inherits consultation image previews');
      await page.waitForFunction(imageId => !window.__services.getState().commentImages.some(image => image.id === imageId), unboundImage);
      assert.equal((await state(page)).writes.filter(write => write.name === 'commentImages:discard').at(-1).args.imageId, unboundImage, 'Unmount discards only the prior account unbound upload');
      assert.equal(await page.getByText('这是博主本人给出的回复。', {exact: true}).count(), 0, 'The next account never inherits inbox content');
      assert.equal((await state(page)).requests.filter(request => request.name === 'consultations:listInbox' && request.userId !== 'fixture-author').length, 0,
        'Inbox queries are never sent for an ordinary account');
      await switchSession(page, 'fixture-author', 'session-author-new');
      await tab(page, '管理').click();
      await inbox.getByRole('button', {name: /第一条私人咨询/}).click();
      assert.equal(await inbox.getByRole('textbox', {name: '回复会员'}).inputValue(), '', 'Returning to the author account does not restore the previous draft');
      await inbox.getByRole('textbox', {name: '回复会员'}).fill('同一作者旧 session 草稿');
      await switchSession(page, 'fixture-author', 'session-author-newer');
      await tab(page, '管理').click();
      await inbox.getByRole('button', {name: /第一条私人咨询/}).click();
      assert.equal(await inbox.getByRole('textbox', {name: '回复会员'}).inputValue(), '', 'A new author session clears the inbox draft and selected conversation');
      await page.getByRole('button', {name: '结束咨询', exact: true}).click();
      await page.getByText('这条咨询已结束，对话记录仍然保留。', {exact: true}).waitFor();
      assert.equal(await page.getByRole('textbox', {name: '回复会员'}).count(), 0);
      await switchSession(page, null, null);
      await page.getByRole('heading', {name: '登录后继续'}).waitFor();
      assert.equal(await page.locator('[data-consultations-panel]').count(), 0);
      assert.equal(await tab(page, '管理').count(), 0, 'Signing out removes the author message entry');
      assert.equal(await tab(page, '咨询').getAttribute('aria-checked'), 'true', 'Signing out from author messages falls back to consultations');
      const actionNames = (await state(page)).writes.map(write => write.name);
      assert.ok(actionNames.includes('consultations:start') && actionNames.includes('consultations:send') && actionNames.includes('consultations:reply'));
      assert.equal((await state(page)).writes.filter(write => write.name === 'consultations:send' && write.userId === 'fixture-author').length, 0,
        'Author replies use the dedicated reply endpoint');
      assert.ok(!actionNames.some(name => name.startsWith('assistant:')), 'Human consultations never dispatch AI calls');
      await switchSession(page, 'fixture-a', 'session-a-personal');
      await page.evaluate(() => window.__services.seedPersonal());
      await tab(page, '我的').click();
      await page.locator('[data-reader-library]').waitFor();
      assert.equal(await myTab(page, '收藏').getAttribute('aria-checked'), 'true');
      assert.equal(await page.getByRole('radiogroup', {name: '我的内容分类', exact: true}).getByRole('radio').count(), 3);
      await myTab(page, '喜欢').click();
      const likes = page.getByRole('region', {name: '喜欢的文章', exact: true});
      await likes.getByRole('link', {name: /账号 A 喜欢的文章/}).waitFor();
      await assertClientCleanup(page);
      assert.equal(await likes.locator('a').getAttribute('href'), '/docs/fixture-a-liked/');
      assert.equal(await likes.getByText('账号 B 喜欢的文章', {exact: true}).count(), 0);
      await tab(page, 'AI 对话').click();
      await tab(page, '我的').click();
      assert.equal(await myTab(page, '喜欢').getAttribute('aria-checked'), 'true', 'Returning to 我的 preserves its current secondary view');
      const imageReadsBeforeMine = imageNetwork.imageReads.length;
      await myTab(page, '评论').click();
      const mine = page.getByRole('region', {name: '我的评论', exact: true});
      await mine.getByText('fixture-a 的个人评论内容', {exact: true}).waitFor();
      assert.equal(await mine.getByText('fixture-b 的个人评论内容', {exact: true}).count(), 0);
      assert.equal(await mine.getByText('已删除个人评论不得展示', {exact: true}).count(), 0);
      assert.equal(await mine.locator('a').getAttribute('href'), '/docs/services-fixture/#comment-personal-fixture-a');
      await mine.getByText('1 张图片', {exact: true}).waitFor();
      assert.equal(await mine.locator('img').count(), 0, 'My comments show only attachment metadata');
      assert.equal(imageNetwork.imageReads.length, imageReadsBeforeMine, 'The personal comment list never fetches comment images');
      await page.screenshot({path: join(tmpdir(), `services-my-comments-${width}.png`), fullPage: true});
      await switchSession(page, 'fixture-b', 'session-b-personal');
      await page.locator('[data-reader-library]').waitFor();
      assert.equal(await myTab(page, '收藏').getAttribute('aria-checked'), 'true', 'Changing accounts resets the personal secondary view');
      await myTab(page, '喜欢').click();
      await likes.getByRole('link', {name: /账号 B 喜欢的文章/}).waitFor();
      assert.equal(await likes.getByText('账号 A 喜欢的文章', {exact: true}).count(), 0);
      await myTab(page, '评论').click();
      await mine.getByText('fixture-b 的个人评论内容', {exact: true}).waitFor();
      assert.equal(await mine.getByText('fixture-a 的个人评论内容', {exact: true}).count(), 0);
      assert.equal(await page.locator('[data-notification-unread]').count(), 0, 'Another account cannot inherit the unread badge');
      await notificationBell(page).click();
      const notifications = page.getByRole('region', {name: '消息通知', exact: true});
      await notifications.getByText('还没有消息。评论回复和博主的咨询回复会出现在这里。', {exact: true}).waitFor();
      assert.equal(await tab(page, '管理').count(), 0);
      await switchSession(page, 'fixture-a', 'session-a-notifications');
      await notifications.getByRole('button', {name: /博主回复了你的咨询/}).waitFor();
      await page.locator('[data-notification-unread]').waitFor();
      assert.equal(await notificationBell(page).getAttribute('aria-label'), '消息（有未读）');
      assert.equal(await notificationBell(page).getAttribute('aria-pressed'), 'true');
      const unavailable = notifications.locator('li').filter({hasText: '这条回复已不可查看。'});
      assert.equal(await unavailable.locator('a, button').count(), 0, 'Unavailable notification targets cannot be opened');
      const unreadBefore = await notifications.locator('[data-unread]').count();
      const replyNotification = (await state(page)).notifications.find(item => item.kind === 'consultation_reply');
      await notifications.getByRole('button', {name: /博主回复了你的咨询/}).click();
      await page.getByRole('heading', {name: '第一条私人咨询', exact: true}).waitFor();
      assert.equal(await tab(page, '咨询').getAttribute('aria-checked'), 'true');
      assert.equal((await state(page)).writes.filter(write => write.name === 'notifications:markRead').at(-1).args.id, replyNotification._id);
      await page.getByRole('button', {name: '返回咨询列表', exact: true}).click();
      await page.getByRole('heading', {name: '与博主交流', exact: true}).waitFor();
      await notificationBell(page).click();
      assert.equal(await notifications.locator('[data-unread]').count(), unreadBefore - 1);
      await page.screenshot({path: join(tmpdir(), `services-notifications-${width}.png`), fullPage: true});
      await assertClientCleanup(page);
      const commentLink = notifications.locator('a[href="/docs/services-fixture/#comment-comment_initial"]');
      await Promise.all([page.waitForURL('**/docs/services-fixture/#comment-comment_initial'), commentLink.click()]);
      assert.equal(notificationReads.at(-1), 'notification-comment', 'Comment notifications are marked read before navigation');
      await page.waitForFunction(() => document.activeElement?.id === 'comment-comment_initial');
      console.log(`Services workspace ${width}px: private consultation images, author management, personal lists, notification routing and comment deep links.`);
    } finally {await context.close();}
  }

  for (const userId of ['fixture-a', 'fixture-author']) {
    const context = await browser.newContext({viewport: {width: 375, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(new URL('/tests/fixtures/services-ui.html', base).href);
      await tab(page, '咨询').waitFor();
      if (userId === 'fixture-author') await switchSession(page, userId, 'session-author-delayed-thread');
      await page.evaluate(() => window.__services.seedConsultationStates());
      await tab(page, userId === 'fixture-author' ? '管理' : '咨询').click();
      const panel = page.locator('[data-consultations-panel]');
      const backName = userId === 'fixture-author' ? '返回管理列表' : '返回咨询列表';
      const draftName = userId === 'fixture-author' ? '回复会员' : '继续咨询';
      const closedTitle = '已结束咨询：状态确认前不展示回复输入框';
      const openTitle = '可回复咨询：确认状态后开始输入';
      const assertNoComposer = async () => {
        assert.equal(await panel.locator('form, textarea, input[type="file"]').count(), 0, 'Unknown, closed or failed consultations never mount a composer or image picker');
        assert.equal(await panel.getByRole('button', {name: /^(添加图片|发送消息|发送回复|结束咨询)$/}).count(), 0);
      };
      await panel.getByRole('button', {name: new RegExp(closedTitle)}).click();
      await panel.locator('[data-consultation-state="loading"]').waitFor();
      await panel.getByRole('heading', {name: closedTitle, exact: true}).waitFor();
      await assertNoComposer();
      assert.equal(await panel.getByRole('button', {name: backName, exact: true}).isEnabled(), true);
      const pendingHeader = await panel.locator('header').boundingBox();
      const pendingMessages = await panel.getByLabel('私人咨询消息', {exact: true}).boundingBox();
      await page.evaluate(() => window.__services.setThreadReadState('state_closed', 'ready'));
      await panel.locator('[data-consultation-state="closed"]').waitFor();
      await panel.getByText('这条咨询已结束，对话记录仍然保留。', {exact: true}).waitFor();
      await assertNoComposer();
      for (const [before, after] of [[pendingHeader, await panel.locator('header').boundingBox()], [pendingMessages, await panel.getByLabel('私人咨询消息', {exact: true}).boundingBox()]]) {
        assert.ok(before && after);
        for (const dimension of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(before[dimension] - after[dimension]) <= 1, `Loading to closed preserves the ${dimension} of the header and saved messages`);
      }
      await panel.getByRole('button', {name: backName, exact: true}).click();
      await panel.getByRole('button', {name: new RegExp(openTitle)}).click();
      await panel.locator('[data-consultation-state="loading"]').waitFor();
      await assertNoComposer();
      await panel.getByRole('heading', {name: openTitle, exact: true}).waitFor();
      await page.evaluate(() => window.__services.setThreadReadState('state_open', 'ready'));
      await panel.locator('[data-consultation-state="open"]').waitFor();
      const draft = panel.getByRole('textbox', {name: draftName, exact: true});
      await draft.fill('上一个咨询的草稿不得泄漏。');
      await panel.getByLabel('选择咨询图片', {exact: true}).setInputFiles(imageFile('previous-thread.png'));
      await panel.getByRole('button', {name: '移除图片 1', exact: true}).waitFor();
      await panel.getByRole('button', {name: backName, exact: true}).click();
      await page.evaluate(() => window.__services.setThreadReadState('state_closed', 'pending'));
      await panel.getByRole('button', {name: new RegExp(closedTitle)}).click();
      await panel.locator('[data-consultation-state="loading"]').waitFor();
      await assertNoComposer();
      assert.equal(await panel.getByText(openTitle, {exact: true}).count(), 0, 'The selected title never comes from the previous conversation');
      assert.equal(await panel.getByRole('img', {name: '待发送图片 1', exact: true}).count(), 0);
      await page.evaluate(() => window.__services.setThreadReadState('state_closed', 'error'));
      await panel.locator('[data-consultation-state="error"]').waitFor();
      await panel.getByRole('alert').filter({hasText: '咨询暂时无法读取，请稍后重试。'}).waitFor();
      await assertNoComposer();
      await panel.getByRole('heading', {name: closedTitle, exact: true}).waitFor();
      assert.equal(await panel.getByRole('button', {name: backName, exact: true}).isEnabled(), true);
      await page.evaluate(() => window.__services.setThreadReadState('state_closed', 'pending'));
      await panel.getByRole('button', {name: '重新读取咨询', exact: true}).click();
      await panel.locator('[data-consultation-state="loading"]').waitFor();
      await assertNoComposer();
      await page.evaluate(() => window.__services.setThreadReadState('state_closed', 'ready'));
      await panel.locator('[data-consultation-state="closed"]').waitFor();
      await assertNoComposer();
      await panel.getByRole('button', {name: backName, exact: true}).click();
      await panel.getByRole('button', {name: new RegExp(openTitle)}).click();
      await draft.waitFor();
      assert.equal(await draft.inputValue(), '', 'Reopening another thread never restores an abandoned draft');
      assert.equal(await panel.getByRole('button', {name: '移除图片 1', exact: true}).count(), 0);
      assert.equal((await state(page)).writes.filter(write => write.name.startsWith('consultations:') || write.name.startsWith('commentImages:')).length, 0, 'State reads, transitions and retries never send a message or upload a file');
      assert.equal((await state(page)).commentImages.length, 0);
      await assertClientCleanup(page);
      console.log(`Consultation status ${userId}: unknown/closed/open/error states, stable closed layout, preserved back/title and isolated drafts passed.`);
    } finally {await context.close();}
  }

  for (const metadataAvailable of [true, false]) {
    const context = await browser.newContext({viewport: {width: 375, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    await context.addCookies([{name: 'fixture_private_cookie', value: 'never-send-to-public-metadata', url: base.origin}]);
    await context.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.__titleFetches = [];
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.pathname !== '/search/references.json') return originalFetch(input, init);
        const record = {credentials: init?.credentials ?? (input instanceof Request ? input.credentials : 'same-origin'), settled: false};
        window.__titleFetches.push(record);
        try {return await originalFetch(input, init);} finally {record.settled = true;}
      };
    });
    const referenceRequests = [];
    await context.route(new URL('/search/references.json', base).href, async route => {
      const request = route.request();
      referenceRequests.push({method: request.method(), url: request.url(), headers: await request.allHeaders(), body: request.postData()});
      const titles = [
        ['/docs/legacy-missing-title/', '公开元数据恢复的文章标题'],
        ['/docs/legacy-pathname-title/', '公开元数据替换路径占位'],
        ['/docs/existing-title/', '元数据不得覆盖已保存标题'],
        ['/docs/测试/', '中文路径对应的文章标题'],
      ];
      const documents = titles.map(([pathname, title], index) => {
        const hash = String(index + 1).repeat(64);
        return {key: `tcitry-blog/articles/${hash}.md`, hash, url: new URL(pathname, base).href, title, section: 'docs'};
      });
      await route.fulfill({status: metadataAvailable ? 200 : 503, contentType: 'application/json', body: JSON.stringify({documents})});
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(new URL('/tests/fixtures/services-ui.html', base).href);
      await tab(page, '我的').waitFor();
      await page.evaluate(() => window.__services.seedLegacyTitles());
      const writesBefore = (await state(page)).writes.filter(write => write.name !== 'membership:getMyMembership');
      await tab(page, '我的').click();
      await myTab(page, '喜欢').click();
      await page.waitForFunction(() => window.__titleFetches.some(request => request.settled));
      const expected = [
        ['/docs/legacy-missing-title/', metadataAvailable ? '公开元数据恢复的文章标题' : 'legacy missing title'],
        ['/docs/legacy-pathname-title/', metadataAvailable ? '公开元数据替换路径占位' : 'legacy pathname title'],
        ['/docs/existing-title/', '已保存的文章标题'],
        ['/docs/%E0%A4%A/', '%E0%A4%A'],
        ['/docs/metadata-missing-title/', 'metadata missing title'],
        ['/docs/%E6%B5%8B%E8%AF%95/', metadataAvailable ? '中文路径对应的文章标题' : '测试'],
      ];
      for (const [name, regionName] of [['喜欢', '喜欢的文章'], ['评论', '我的评论']]) {
        await myTab(page, name).click();
        const region = page.getByRole('region', {name: regionName, exact: true});
        for (const [index, [pathname, title]] of expected.entries()) {
          const href = name === '喜欢' ? pathname : `${pathname}#comment-legacy-title-${index}`;
          const link = region.locator(`a[href="${href}"]`);
          await link.getByText(title, {exact: true}).waitFor();
          assert.equal(await link.getAttribute('href'), href, 'Title restoration keeps the canonical destination unchanged');
        }
        assert.equal(await region.locator('a').count(), expected.length);
        assert.equal(await region.getByText('元数据不得覆盖已保存标题', {exact: true}).count(), 0);
        assert.equal(await region.getByRole('alert').count(), 0, 'Missing metadata and malformed percent escapes never break personal lists');
      }
      await myTab(page, '喜欢').click();
      await page.getByRole('region', {name: '喜欢的文章', exact: true}).getByText('已保存的文章标题', {exact: true}).waitFor();
      assert.equal(referenceRequests.length, 1, 'Likes and personal comments share one public metadata request, including after failure');
      assert.deepEqual(await page.evaluate(() => window.__titleFetches.map(request => request.credentials)), ['omit']);
      const request = referenceRequests[0];
      assert.equal(request.method, 'GET');
      assert.equal(request.url, new URL('/search/references.json', base).href, 'No private record or pathname is placed in the metadata request URL');
      assert.equal(request.body, null);
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers.cookie, undefined, 'Public metadata omits even a present same-origin private cookie');
      assert.deepEqual((await state(page)).writes.filter(write => write.name !== 'membership:getMyMembership'), writesBefore, 'Restoring display titles never writes back private records');
      await assertClientCleanup(page);
      console.log(`Legacy personal titles: metadata ${metadataAvailable ? 'available' : 'unavailable'}, stable stored titles, malformed path safety and credential-free shared lookup.`);
    } finally {await context.close();}
  }

  if (scope !== 'images') {
  const aiContext = await browser.newContext({viewport: {width: 375, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await aiContext.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  const aiPage = await aiContext.newPage();
  aiPage.setDefaultTimeout(15_000);
  aiPage.on('pageerror', error => errors.push(error.message));
  try {
    await aiPage.goto(new URL('/tests/fixtures/services-ui.html', base).href);
    await tab(aiPage, '我的').waitFor();
    assert.equal(await tab(aiPage, '我的').getAttribute('aria-checked'), 'true');
    await tab(aiPage, 'AI 对话').click();
    const ai = aiPage.getByRole('region', {name: '与 AI 博客助手对话', exact: true});
    await ai.getByRole('link', {name: '已核验的文章', exact: true}).waitFor();
    assert.equal(await ai.getByRole('link', {name: '已核验的文章', exact: true}).getAttribute('href'), 'https://yindongliang.com/docs/rag-fixture/');
    assert.equal(await ai.locator('a[href*="example.invalid"]').count(), 0, 'Answer links are restricted to retrieved citations');
    assert.equal(await ai.locator('.blog-chat__answer img').count(), 0, 'Untrusted Markdown images render as text');
    await ai.getByRole('heading', {name: '已保存的 RAG 问题', exact: true}).waitFor();
    const transcript = ai.getByRole('region', {name: 'AI 对话记录', exact: true});
    const composerLayout = ai.locator('.blog-chat__composer');
    const beforeHistory = {transcript: await transcript.boundingBox(), composer: await composerLayout.boundingBox()};
    await ai.getByRole('button', {name: '历史', exact: true}).click();
    const history = aiPage.locator('[data-agent-history-popover]');
    await history.waitFor();
    await history.getByRole('listbox', {name: '选择 AI 对话', exact: true}).waitFor();
    assert.equal(await history.getByRole('option', {name: '已保存的 RAG 问题', exact: true}).getAttribute('aria-selected'), 'true');
    const assertHistoryGeometry = async (description) => {
      const current = {transcript: await transcript.boundingBox(), composer: await composerLayout.boundingBox()};
      for (const key of ['transcript', 'composer']) {
        assert.ok(beforeHistory[key] && current[key]);
        for (const dimension of ['x', 'y', 'width', 'height']) {
          assert.ok(Math.abs(beforeHistory[key][dimension] - current[key][dimension]) <= 1,
            `${description} never changes the ${key} ${dimension}`);
        }
      }
    };
    await assertHistoryGeometry('Opening history');
    await aiPage.screenshot({path: join(tmpdir(), 'services-ai-history-375.png'), fullPage: true});
    await history.getByRole('option', {name: '第二条已保存对话：关于 Cloudflare AI Search、Convex Agent 与 Clerk 会员服务的长标题记录', exact: true}).click();
    await history.waitFor({state: 'hidden'});
    await ai.getByText('另一条历史回答。', {exact: true}).waitFor();
    await ai.getByRole('heading', {name: '第二条已保存对话：关于 Cloudflare AI Search、Convex Agent 与 Clerk 会员服务的长标题记录', exact: true}).waitFor();
    await assertHistoryGeometry('Closing history after selection');
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
    await tab(aiPage, '我的').click();
    await aiPage.locator('[data-reader-library]').waitFor();
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

  }
  const widgetContext = await browser.newContext({viewport: {width: 375, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await widgetContext.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  const widgetPage = await widgetContext.newPage();
  widgetPage.setDefaultTimeout(15_000);
  widgetPage.on('pageerror', error => errors.push(error.message));
  const widgetImageNetwork = await installImageRoutes(widgetContext, widgetPage, base);
  try {
    const widgetURL = new URL('/tests/fixtures/services-ui.html?view=widget', base).href;
    await widgetPage.goto(widgetURL + '&anonymous=true');
    const launcher = widgetPage.locator('[data-chat-launcher]');
    const dialog = widgetPage.locator('#blog-chat-panel');
    await launcher.click();
    await tab(widgetPage, '我的').click();
    await widgetPage.getByRole('heading', {name: '登录后继续'}).waitFor();
    assert.equal(await widgetPage.locator('.assistant-workspace__switcher').getByRole('radio').count(), 3, 'Anonymous navigation has three tabs plus the notification bell');
    assert.equal(await notificationBell(widgetPage).count(), 1);
    assert.equal(await widgetPage.locator('[data-notification-unread]').count(), 0);
    assert.equal(await tab(widgetPage, '管理').count(), 0);
    assert.equal((await state(widgetPage)).requests.filter(request => ['comments:listMine', 'comments:listLikedArticles', 'notifications:list', 'notifications:hasUnread'].includes(request.name)).length, 0,
      'Anonymous personal views never request comments, likes or notifications');
    assert.equal((await state(widgetPage)).writes.filter(write => write.name === 'membership:getMyMembership').length, 0,
      'The account menu never queries membership before authentication');
    assert.deepEqual(await widgetPage.evaluate(() => JSON.parse(sessionStorage.getItem('blog-assistant-ui'))), {pathname: '/tests/fixtures/services-ui.html', view: 'my'});
    // Simulate leaving the site for OAuth, then returning as an authenticated user.
    await widgetPage.goto('about:blank');
    await widgetPage.goto(widgetURL);
    await widgetPage.locator('[data-reader-library]').waitFor();
    assert.equal(await launcher.getAttribute('aria-expanded'), 'true');
    assert.equal(await tab(widgetPage, '我的').getAttribute('aria-checked'), 'true');
    for (const width of [1000, 375]) {
      await widgetPage.setViewportSize({width, height: 900});
      await widgetPage.waitForFunction((mobile) => document.querySelector('#blog-chat-panel')?.matches(':modal') === mobile, width < 640);
      const account = widgetPage.getByRole('button', {name: '账户菜单', exact: true});
      const menu = widgetPage.getByRole('menu', {name: '账户菜单', exact: true});
      await account.click();
      await menu.getByRole('menuitem', {name: 'Pro 会员 · 管理订阅', exact: true}).click();
      const profile = widgetPage.getByRole('dialog', {name: 'Clerk 账户与订阅（测试）', exact: true});
      await profile.waitFor();
      assert.deepEqual(await widgetPage.evaluate(() => window.__servicesClerk.getState().profileRequests.at(-1).options), {__experimental_startPath: '/billing'});
      assert.equal(await profile.evaluate(element => !!element.closest('.blog-clerk-modal')), true);
      assert.equal(await profile.evaluate(element => !!element.closest('#blog-chat-panel')), width < 640,
        'The Clerk profile uses the configured body portal on desktop and native dialog portal on mobile');
      await widgetPage.screenshot({path: join(tmpdir(), `services-clerk-profile-${width}.png`), fullPage: true});
      await widgetPage.keyboard.press('Escape');
      await profile.waitFor({state: 'hidden'});
      assert.equal(await dialog.evaluate(element => element.open), true, `The first Escape dismisses only the Clerk profile at ${width}px`);
      assert.equal(await tab(widgetPage, '我的').getAttribute('aria-checked'), 'true');
      const escapes = await widgetPage.evaluate(() => window.__servicesClerk.getState().profileEscapes);
      assert.deepEqual(escapes.at(-1), {defaultPrevented: true, inNativeDialog: width < 640},
        'The host prevents native dialog cancellation while Clerk still receives and handles the same Escape');
      await widgetPage.keyboard.press('Escape');
      await dialog.waitFor({state: 'hidden'});
      assert.equal(await launcher.getAttribute('aria-expanded'), 'false', `The second Escape dismisses the assistant at ${width}px`);
      await launcher.click();
      await account.click();
      await menu.getByRole('menuitem', {name: 'Pro 会员 · 管理订阅', exact: true}).waitFor();
      assert.equal(await tab(widgetPage, '我的').getAttribute('aria-checked'), 'true', 'Closing the profile and panel preserves the selected service and membership state');
      await account.click();
    }
    await tab(widgetPage, '咨询').click();
    await widgetPage.getByRole('button', {name: '发起咨询', exact: true}).click();
    await widgetPage.getByLabel('选择咨询图片', {exact: true}).setInputFiles(imageFile('new-consultation.png', 'portrait'));
    assert.equal(await widgetPage.getByRole('button', {name: '发起咨询', exact: true}).isDisabled(), true, 'An image-only consultation still requires a topic');
    await widgetPage.getByRole('textbox', {name: '咨询主题', exact: true}).fill('仅图片的私人咨询');
    const newConsultation = widgetPage.locator('[data-consultations-panel] form');
    const background = newConsultation.getByRole('textbox', {name: '问题与背景', exact: true});
    await background.fill('上传失败时保留的咨询草稿');
    const preview = await newConsultation.getByRole('img', {name: '待发送图片 1', exact: true}).getAttribute('src');
    const createsBeforeFailure = (await state(widgetPage)).writes.filter(write => write.name === 'consultations:start').length;
    for (const [status, code, message] of [
      [401, 'UNAUTHENTICATED', '登录状态已过期，请重新登录后上传图片。'],
      [413, 'FILE_TOO_LARGE', '每张图片不能超过 5 MB，请缩小图片后重试。'],
      [429, 'RATE_LIMITED', '图片上传过于频繁，请稍后重试。'],
      [400, 'INVALID_ARGUMENT', '图片格式或内容不符合要求，请重新选择 JPEG、PNG、WebP 或 GIF 图片。'],
      [503, 'UPLOAD_FAILED', '图片上传未完成，请稍后重试。'],
      [0, 'NETWORK', '无法连接图片服务，请检查网络后重试。'],
    ]) {
      widgetImageNetwork.failNextUpload = {status, code};
      await newConsultation.getByRole('button', {name: '发起咨询', exact: true}).click();
      await newConsultation.getByRole('alert').filter({hasText: message}).waitFor();
      assert.equal(await newConsultation.getByRole('alert').count(), 1, `Upload failure ${code} shows only one explanation`);
      assert.doesNotMatch(await newConsultation.innerText(), /private-provider-detail|暂时无法完成操作/);
      assert.equal(await newConsultation.getByRole('textbox', {name: '咨询主题', exact: true}).inputValue(), '仅图片的私人咨询');
      assert.equal(await background.inputValue(), '上传失败时保留的咨询草稿');
      assert.equal(await newConsultation.getByRole('img', {name: '待发送图片 1', exact: true}).getAttribute('src'), preview);
      assert.equal(await newConsultation.getByRole('button', {name: '移除图片 1', exact: true}).isEnabled(), true);
      assert.equal((await state(widgetPage)).writes.filter(write => write.name === 'consultations:start').length, createsBeforeFailure,
        'A failed image upload never creates a consultation or sends a partial message');
    }
    await background.fill('');
    await widgetPage.getByRole('button', {name: '发起咨询', exact: true}).click();
    await widgetPage.getByRole('heading', {name: '仅图片的私人咨询', exact: true}).waitFor();
    assert.equal((await state(widgetPage)).messages[0].content, '');
    assert.equal((await state(widgetPage)).messages[0].imageIds.length, 1);
    await dialog.getByRole('button', {name: '查看图片 1', exact: true}).click();
    const consultationImage = widgetPage.getByRole('dialog', {name: '咨询图片', exact: true});
    await consultationImage.waitFor();
    await consultationImage.locator('img').evaluate(image => image.decode());
    assert.deepEqual(await consultationImage.locator('img').evaluate(image => [image.naturalWidth, image.naturalHeight]), [240, 480]);
    assert.equal(await consultationImage.evaluate(element => !!element.closest('#blog-chat-panel:modal')), true, 'A mobile image dialog stays inside the native assistant top layer');
    await widgetPage.screenshot({path: join(tmpdir(), 'services-consultation-image-modal-375.png'), fullPage: true});
    await widgetPage.keyboard.press('Escape');
    await consultationImage.waitFor({state: 'hidden'});
    assert.equal(await dialog.evaluate(element => element.open), true, 'The first Escape closes the consultation image without closing the assistant');
    await widgetPage.keyboard.press('Escape');
    await dialog.waitFor({state: 'hidden'});
    await assertClientCleanup(widgetPage);
    await launcher.click();
    assert.equal(await tab(widgetPage, '咨询').getAttribute('aria-checked'), 'true');
    await tab(widgetPage, 'AI 对话').click();
    const composer = widgetPage.getByRole('textbox', {name: '向 AI 博客助手提问', exact: true});
    await composer.waitFor();
    const historyButton = widgetPage.getByRole('button', {name: '历史', exact: true});
    await historyButton.click();
    const widgetHistory = widgetPage.locator('[data-agent-history-popover]');
    await widgetHistory.waitFor();
    await widgetPage.keyboard.press('Escape');
    await widgetHistory.waitFor({state: 'hidden'});
    assert.equal(await dialog.evaluate(element => element.open), true, 'Escape closes the history popover while keeping the native assistant panel open');
    assert.equal(await launcher.getAttribute('aria-expanded'), 'true');
    assert.equal(await historyButton.getAttribute('aria-expanded'), 'false');
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
    await switchSession(widgetPage, 'fixture-author', 'session-author-callback');
    await launcher.click();
    await tab(widgetPage, '管理').click();
    await widgetPage.locator('[data-consultations-inbox]').getByRole('heading', {name: '管理', exact: true}).waitFor();
    assert.deepEqual(await widgetPage.evaluate(() => JSON.parse(sessionStorage.getItem('blog-assistant-ui'))), {pathname: '/tests/fixtures/services-ui.html', view: 'admin'});
    // The callback starts a fresh fixture session as an ordinary member. The
    // remembered public view is not authorization to mount an author inbox.
    await widgetPage.goto('about:blank');
    await widgetPage.goto(widgetURL);
    await widgetPage.getByRole('heading', {name: '与博主交流', exact: true}).waitFor();
    assert.equal(await tab(widgetPage, '咨询').getAttribute('aria-checked'), 'true');
    assert.equal(await tab(widgetPage, '管理').count(), 0);
    assert.equal(await widgetPage.locator('[data-consultations-inbox]').count(), 0);
    assert.equal((await state(widgetPage)).requests.filter(request => request.name === 'consultations:listInbox').length, 0,
      'Restoring an author tab never requests inbox data before the account role is verified');
    assert.deepEqual(await widgetPage.evaluate(() => JSON.parse(sessionStorage.getItem('blog-assistant-ui'))), {pathname: '/tests/fixtures/services-ui.html', view: 'consult'});
    console.log('Assistant callback: open/tab restoration, explicit close, private state isolation and safe non-author fallback from messages.');
  } finally {await widgetContext.close();}

  }
  if (['all', 'workspace', 'navigation'].includes(scope)) {
  for (const width of [1016, 757, 375, 320]) {
    const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    await context.addInitScript(() => localStorage.setItem('blog-assistant-pinned', 'true'));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin) {await route.abort(); return;}
      if (['/docs/navigation-fixture-a/', '/docs/navigation-fixture-b/'].includes(url.pathname)) {
        // Real document navigation exercises restoration with retired pin data
        // deliberately present on every page. No production requests are made.
        await route.fulfill({response: await route.fetch({url: new URL('/tests/fixtures/services-ui.html', base).href})});
      } else await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => errors.push(error.message));
    const networkWrites = [];
    page.on('request', request => {if (!['GET', 'HEAD'].includes(request.method())) networkWrites.push(request.url());});
    const path = letter => `/docs/navigation-fixture-${letter}/`;
    const address = letter => new URL(`${path(letter)}?view=widget&articleNavigation=true`, base).href;
    const panel = page.locator('#blog-chat-panel');
    const launcher = page.locator('[data-chat-launcher]');
    const expand = page.locator('[data-chat-expand]');
    const close = page.getByRole('button', {name: '关闭博客助手', exact: true});
    const stored = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('blog-assistant-ui') ?? 'null'));
    const noWrites = async () => assert.deepEqual((await state(page)).writes.filter(write => write.name !== 'membership:getMyMembership'), [], 'Opening and navigation never write private business data');
    const readyClosed = async () => {
      await launcher.waitFor(); await expand.waitFor();
      assert.equal(await panel.evaluate(element => element.open), false);
      assert.equal(await stored(), null, 'Closed navigation clears the old open-view session record');
    };
    const readyOpen = async (letter, view = 'my') => {
      await notificationBell(page).waitFor();
      await page.waitForFunction(({pathname, view}) => {
        const value = JSON.parse(sessionStorage.getItem('blog-assistant-ui') ?? 'null');
        return document.querySelector('#blog-chat-panel')?.open && value?.pathname === pathname && value.view === view;
      }, {pathname: path(letter), view});
      assert.equal(await tab(page, view === 'my' ? '我的' : 'AI 对话').getAttribute('aria-checked'), 'true');
      assert.equal(await panel.evaluate(element => element.matches(':modal')), width < 640);
    };
    const navigate = async letter => {
      await noWrites();
      const link = page.getByRole('link', {name: `前往测试文章 ${letter.toUpperCase()}`, exact: true});
      if (await panel.evaluate(element => element.matches(':modal'))) {
        // A mobile modal makes background links inert; navigate to their actual
        // destination without weakening native focus/accessibility behavior.
        await page.goto(new URL(await link.getAttribute('href'), base).href);
      } else await Promise.all([page.waitForURL(address(letter)), link.click()]);
      await launcher.waitFor({state: 'attached'});
      assert.equal(new URL(page.url()).pathname, path(letter));
    };
    try {
      await page.goto(address('a'));
      await readyClosed();
      const expandBox = await expand.boundingBox();
      assert.ok(expandBox);
      await launcher.click();
      await readyOpen('a');
      assert.equal(await page.locator('.assistant-workspace__switcher [role=radio]').first().textContent(), '我的');
      assert.equal(await page.locator('[data-workspace-pin]').count(), 0, 'The removed pin control never renders');
      await tab(page, 'AI 对话').click();
      await readyOpen('a', 'chat');
      await page.reload();
      await readyOpen('a', 'chat');
      await navigate('b');
      await readyClosed();
      await page.goBack(); await page.waitForURL(address('a')); await readyClosed();
      await expand.click(); await readyOpen('a');
      await tab(page, 'AI 对话').click(); await readyOpen('a', 'chat');
      await close.focus(); await page.keyboard.press('Enter'); await readyClosed();
      assert.equal(await expand.evaluate(element => document.activeElement === element), true);
      await expand.click(); await readyOpen('a', 'chat');
      await close.focus(); await page.keyboard.press('Escape'); await readyClosed();
      await page.reload(); await readyClosed();
      await launcher.click(); await readyOpen('a');
      await switchSession(page, 'fixture-author', 'session-navigation-layout');
      await tab(page, '管理').waitFor();
      const navigation = page.locator('.assistant-workspace__switcher');
      const rail = navigation.locator('.assistant-workspace__tabs');
      for (const name of ['AI 对话', '咨询', '我的', '管理']) {
        await tab(page, name).click();
        await page.waitForFunction(label => {
          const button = [...document.querySelectorAll('.assistant-workspace__switcher [role="radio"]')].find(item => item.textContent === label);
          const rail = document.querySelector('.assistant-workspace__tabs');
          const bell = document.querySelector('[data-workspace-notifications]');
          if (!button || !rail || !bell) return false;
          const a = button.getBoundingClientRect(), b = rail.getBoundingClientRect(), c = bell.getBoundingClientRect();
          return a.left >= b.left - 1 && a.right <= Math.min(b.right, c.left) + 1;
        }, name);
      }
      const bellBox = await notificationBell(page).boundingBox();
      const accountBox = await navigation.locator('.cl-userButtonTrigger').boundingBox();
      assert.ok(bellBox && accountBox && bellBox.x + bellBox.width <= accountBox.x);
      assert.equal(await rail.evaluate(element => getComputedStyle(element).overflowX), 'auto');
      assert.equal(await navigation.locator('[data-workspace-pin]').count(), 0);
      const edge = page.getByRole('group', {name: '侧栏操作', exact: true});
      const edgeBox = await edge.boundingBox();
      const workspaceBox = await page.locator('.assistant-workspace').boundingBox();
      assert.ok(edgeBox && workspaceBox);
      assert.equal(await edge.locator('button').count(), 1);
      assert.equal(await page.locator('.assistant-workspace [data-article-bookmark]').count(), 0);
      assert.ok(Math.abs(edgeBox.y + edgeBox.height / 2 - workspaceBox.y - workspaceBox.height / 2) <= 1);
      if (width >= 640) assert.ok(Math.abs(edgeBox.x + edgeBox.width - workspaceBox.x) <= 1);
      else assert.ok(edgeBox.x >= 0 && edgeBox.x + edgeBox.width <= width);
      const closeBox = await close.boundingBox();
      assert.ok(closeBox);
      assert.equal(closeBox.width, expandBox.width); assert.equal(closeBox.height, expandBox.height);
      assert.equal(closeBox.width, width < 640 ? 32 : 24); assert.equal(closeBox.height, 56);
      assert.equal(edgeBox.height, closeBox.height);
      assert.equal(await close.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await switchSession(page, 'fixture-a', 'session-navigation-member');
      await tab(page, '我的').click(); await readyOpen('a');
      await page.screenshot({path: join(tmpdir(), `services-sidebar-navigation-${width}.png`), fullPage: true});
      await navigate('b'); await readyClosed();
      await expand.click(); await readyOpen('b');
      await close.click(); await readyClosed();
      assert.equal(await expand.evaluate(element => document.activeElement === element), true);
      await navigate('a'); await readyClosed();
      await page.reload(); await readyClosed();
      assert.equal(await page.evaluate(() => localStorage.getItem('blog-assistant-pinned')), 'true', 'An old pin value is ignored rather than restoring cross-page state');
      await noWrites();
      assert.deepEqual(networkWrites, []);
      console.log(`Sidebar navigation ${width}px: retired pin ignored, cross-page collapse, same-page restoration, keyboard/Escape, focus and handle geometry passed.`);

      // Bookmark mutations below remain in the isolated fixture. The preceding
      // navigation-only flow is separately verified to perform no business writes.
      await expand.click();
      await tab(page, '我的').click();
      await page.evaluate(() => window.__services.seedBookmarks());
      const footer = page.locator('[data-fixture-article-footer]');
      const bookmark = footer.locator('[data-article-bookmark]');
      const toggleArticleBookmark = async () => {
        const modal = await panel.evaluate(element => element.matches(':modal'));
        if (modal) await close.click();
        await bookmark.click();
        if (modal) {await expand.click(); await tab(page, '我的').click();}
      };
      assert.equal(await page.locator('[data-article-bookmark]').count(), 1, 'The current article has one bookmark entry at its footer');
      const library = page.locator('[data-reader-library]');
      await library.getByRole('link', {name: '账号 A 收藏的另一篇文章', exact: true}).waitFor();
      assert.equal(await bookmark.getAttribute('aria-pressed'), 'false', 'A bookmark on another pathname does not mark the current article');
      assert.equal(await library.getByRole('link', {name: '账号 B 收藏的当前文章', exact: true}).count(), 0);
      assert.equal(await page.locator('[data-reader-article]').count(), 0, 'My content does not duplicate the current article bookmark block');
      const bookmarkWritesBefore = (await state(page)).writes.length;
      await page.evaluate(() => window.__services.failNextBookmark());
      await toggleArticleBookmark();
      await footer.locator('[role=alert]').filter({hasText: '收藏未能保存'}).waitFor();
      assert.equal(await bookmark.getAttribute('aria-pressed'), 'false', 'A failed bookmark write preserves its unselected state');
      assert.equal(await library.getByRole('link', {name: '公开文章测试', exact: true}).count(), 0, 'Failed saves never insert a phantom bookmark');
      await toggleArticleBookmark();
      await page.waitForFunction(() => document.querySelector('[data-article-bookmark]')?.getAttribute('aria-pressed') === 'true');
      await library.getByRole('link', {name: '公开文章测试', exact: true}).waitFor();
      await switchSession(page, 'fixture-b', 'session-bookmark-b');
      await library.getByRole('link', {name: '账号 B 收藏的当前文章', exact: true}).waitFor();
      assert.equal(await bookmark.getAttribute('aria-pressed'), 'true', 'The article footer shows the new account’s own current article state');
      assert.equal(await library.getByRole('link', {name: /账号 A|公开文章测试/}).count(), 0, 'The bookmark list never leaks the previous account’s entries');
      await toggleArticleBookmark();
      await page.waitForFunction(() => document.querySelector('[data-article-bookmark]')?.getAttribute('aria-pressed') === 'false');
      assert.equal(await library.getByRole('link', {name: '账号 B 收藏的当前文章', exact: true}).count(), 0);
      await switchSession(page, 'fixture-a', 'session-bookmark-a');
      await page.waitForFunction(() => document.querySelector('[data-article-bookmark]')?.getAttribute('aria-pressed') === 'true');
      await library.getByRole('link', {name: '公开文章测试', exact: true}).waitFor();
      await switchSession(page, 'fixture-a', 'session-bookmark-a-new');
      await page.waitForFunction(() => document.querySelector('[data-article-bookmark]')?.getAttribute('aria-pressed') === 'true');
      await library.getByRole('link', {name: '公开文章测试', exact: true}).waitFor();
      await toggleArticleBookmark();
      await page.waitForFunction(() => document.querySelector('[data-article-bookmark]')?.getAttribute('aria-pressed') === 'false');
      assert.equal(await library.getByRole('link', {name: '公开文章测试', exact: true}).count(), 0);
      await library.getByRole('link', {name: '账号 A 收藏的另一篇文章', exact: true}).waitFor();
      const attempts = (await state(page)).writes.slice(bookmarkWritesBefore).filter(write => write.name !== 'membership:getMyMembership');
      assert.deepEqual(attempts.map(write => ({name: write.name, userId: write.userId, args: write.args})), [
        {name: 'reader:setBookmark', userId: 'fixture-a', args: {pathname: '/docs/services-fixture/', title: '公开文章测试', bookmarked: true}},
        {name: 'reader:setBookmark', userId: 'fixture-a', args: {pathname: '/docs/services-fixture/', title: '公开文章测试', bookmarked: true}},
        {name: 'reader:setBookmark', userId: 'fixture-b', args: {pathname: '/docs/services-fixture/', title: '公开文章测试', bookmarked: false}},
        {name: 'reader:setBookmark', userId: 'fixture-a', args: {pathname: '/docs/services-fixture/', title: '公开文章测试', bookmarked: false}},
      ], 'Only the four explicit bookmark attempts mutate fixture data');
      const beforeSignOut = await state(page);
      await switchSession(page, null, null);
      await page.locator('.assistant-workspace__view').getByRole('button', {name: '登录 / 注册', exact: true}).waitFor();
      await library.waitFor({state: 'detached'});
      const anonymous = await state(page);
      assert.equal(anonymous.requests.filter(request => request.name.startsWith('reader:')).length,
        beforeSignOut.requests.filter(request => request.name.startsWith('reader:')).length, 'Anonymous article footer and My state issue no private bookmark queries');
      assert.equal(anonymous.writes.length, beforeSignOut.writes.length, 'Signing out performs no bookmark write');
      if (await panel.evaluate(element => element.open)) await close.click();
      const writesBeforeLogin = (await state(page)).writes.filter(write => write.name !== 'membership:getMyMembership').length;
      await bookmark.click();
      await footer.getByRole('textbox', {name: '你的评论', exact: true}).waitFor();
      assert.equal(await footer.getByRole('button', {name: '登录 / 注册', exact: true}).count(), 0, 'The anonymous bookmark uses the existing Clerk sign-in entry');
      assert.equal((await state(page)).writes.filter(write => write.name !== 'membership:getMyMembership').length, writesBeforeLogin, 'Clicking an anonymous bookmark signs in without an implicit save');
      const articleActions = footer.locator('.blog-comments__article-actions');
      const bookmarkBox = await bookmark.boundingBox();
      const likeBox = await articleActions.getByRole('button', {name: '喜欢这篇文章', exact: true}).boundingBox();
      assert.ok(bookmarkBox && likeBox && likeBox.x + likeBox.width <= bookmarkBox.x, 'Article likes and bookmarks form one uncluttered footer action group');
      await page.mouse.move(5, 300); await bookmark.hover();
      await page.getByRole('tooltip', {name: '收藏文章', exact: true}).waitFor();
      const footerTip = await page.getByRole('tooltip', {name: '收藏文章', exact: true}).boundingBox();
      assert.ok(footerTip && footerTip.x >= 0 && footerTip.x + footerTip.width <= width + 1, 'Footer bookmark tooltip fits the viewport');
      await page.screenshot({path: join(tmpdir(), `services-article-bookmark-${width}.png`), fullPage: true});
      assert.deepEqual(networkWrites, [], 'Article bookmark checks never contact real services');
      await assertClientCleanup(page);
      console.log(`Article bookmarks ${width}px: unique footer entry, list synchronization, rejected-write recovery, account/path isolation and anonymous query gating.`);
    } catch (error) {
      await page.screenshot({path: join(tmpdir(), `services-navigation-failure-${width}.png`), fullPage: true}).catch(() => {});
      throw error;
    } finally {await context.close();}
  }
  }
  if (!['workspace', 'navigation'].includes(scope)) {
  for (const waiting of ['summary', 'list']) {
    const pendingContext = await browser.newContext({viewport: {width: 375, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    await pendingContext.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    await pendingContext.addInitScript(() => {
      const originalTimeout = window.setTimeout.bind(window);
      window.__commentWaitDeadlines = [];
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 15_000) window.__commentWaitDeadlines.push(delay);
        // Keep the production deadline observable, but advance only these
        // bounded loading timers quickly in the isolated fixture.
        return originalTimeout(callback, delay === 15_000 ? 1_000 : delay, ...args);
      };
    });
    const pendingPage = await pendingContext.newPage();
    pendingPage.setDefaultTimeout(15_000);
    pendingPage.on('pageerror', error => errors.push(error.message));
    try {
      const name = waiting === 'summary' ? 'comments:getSummary' : 'comments:list';
      const label = waiting === 'summary' ? '正在读取评论数量…' : '正在读取评论…';
      const message = waiting === 'summary' ? '评论数量读取时间过长，请检查网络后重试。' : '评论读取时间过长，你的草稿已保留，可以重试。';
      const retryLabel = waiting === 'summary' ? '重新读取评论数量' : '重新读取评论';
      await pendingPage.goto(new URL(`/tests/fixtures/services-ui.html?view=comments&waitingCommentQuery=${waiting}${waiting === 'summary' ? '&anonymous=true' : ''}`, base).href);
      await pendingPage.getByText(label, {exact: true}).waitFor();
      const draft = pendingPage.getByRole('textbox', {name: '你的评论', exact: true});
      let preview;
      if (waiting === 'summary') {
        assert.equal(await pendingPage.getByRole('textbox').count(), 0);
        assert.equal(await pendingPage.getByText('0 条评论', {exact: true}).count(), 0, 'An unresolved count is never shown as zero');
      } else {
        await pendingPage.getByText('1 条评论', {exact: true}).waitFor();
        await draft.fill('列表重试必须保留这份草稿。');
        await pendingPage.locator('input[type="file"]').setInputFiles(imageFile('waiting-list.png'));
        preview = await pendingPage.getByRole('img', {name: '待发布图片 1', exact: true}).getAttribute('src');
        await pendingPage.evaluate(() => {window.__waitingDraftElement = document.getElementById('comment-body');});
      }
      await pendingPage.getByRole('alert').filter({hasText: message}).waitFor();
      assert.equal(await pendingPage.getByText(label, {exact: true}).count(), 0, 'The first query has a bounded loading state');
      assert.equal(await pendingPage.getByRole('button', {name: '刷新页面', exact: true}).count(), 0, 'Retrying a pending comment query never requires a document refresh');
      const readsBefore = (await state(pendingPage)).requests.filter(request => request.name === name).length;
      await pendingPage.getByRole('button', {name: retryLabel, exact: true}).click();
      await pendingPage.getByText(label, {exact: true}).waitFor();
      await pendingPage.waitForFunction(({name, readsBefore}) => window.__services.getState().requests.filter(request => request.name === name).length > readsBefore, {name, readsBefore});
      if (waiting === 'list') {
        assert.equal(await draft.inputValue(), '列表重试必须保留这份草稿。');
        assert.equal(await pendingPage.evaluate(() => window.__waitingDraftElement === document.getElementById('comment-body')), true, 'A list retry does not remount its composer');
        assert.equal(await pendingPage.getByRole('img', {name: '待发布图片 1', exact: true}).getAttribute('src'), preview, 'Local image previews survive resubscribing the list');
      }
      await pendingPage.getByRole('alert').filter({hasText: message}).waitFor();
      await pendingPage.evaluate(name => window.__services.waitForCommentQuery(name, false), name);
      if (waiting === 'summary') {
        await pendingPage.getByText('1 条评论', {exact: true}).waitFor();
        await pendingPage.getByRole('button', {name: '登录 / 注册', exact: true}).waitFor();
        assert.ok((await state(pendingPage)).requests.every(request => request.name === 'comments:getSummary'), 'Anonymous retries and late recovery only read public counts');
      } else {
        await pendingPage.getByText('登录后可见的初始评论正文', {exact: true}).waitFor();
        assert.equal(await draft.inputValue(), '列表重试必须保留这份草稿。');
        assert.equal(await pendingPage.getByRole('img', {name: '待发布图片 1', exact: true}).getAttribute('src'), preview);
        await pendingPage.evaluate(() => window.__services.waitForCommentQuery('comments:list', true));
        await pendingPage.getByText(label, {exact: true}).waitFor();
        await switchSession(pendingPage, 'fixture-b', 'session-pending-list-b');
        await draft.waitFor();
        assert.equal(await draft.inputValue(), '', 'A new account never inherits a timed-out query draft');
        assert.equal(await pendingPage.getByRole('img', {name: '待发布图片 1', exact: true}).count(), 0);
        const beforeSignOut = (await state(pendingPage)).requests.filter(request => request.name === name).length;
        await switchSession(pendingPage, null, null);
        await pendingPage.getByRole('button', {name: '登录 / 注册', exact: true}).waitFor();
        await pendingPage.waitForTimeout(1_100);
        assert.equal(await pendingPage.getByText(message, {exact: true}).count(), 0, 'An unmounted private query timeout cannot reappear after sign-out');
        assert.equal((await state(pendingPage)).requests.filter(request => request.name === name).length, beforeSignOut);
      }
      assert.equal(await pendingPage.getByText(message, {exact: true}).count(), 0, 'A late successful subscription clears the timeout automatically');
      assert.ok(await pendingPage.evaluate(() => window.__commentWaitDeadlines.length >= 2 && window.__commentWaitDeadlines.every(delay => delay === 15_000)));
      assert.deepEqual((await state(pendingPage)).writes, [], 'Waiting, retrying, and recovering never write comments, likes or attachments');
      assert.equal((await state(pendingPage)).commentImages.length, 0, 'Keeping an image draft does not upload it');
      await assertClientCleanup(pendingPage);
      console.log(`Pending comment ${waiting}: bounded wait, local resubscription, late recovery and draft/account isolation passed.`);
    } finally {await pendingContext.close();}
  }
  const context = await browser.newContext({viewport: {width: 375, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  const imageNetwork = await installImageRoutes(context, page, base);
  const {uploadRequests, imageReads} = imageNetwork;
  try {
    await page.goto(new URL('/tests/fixtures/services-ui.html?view=comments&anonymous=true&bookStyles=true', base).href);
    await page.getByText('1 条评论', {exact: true}).waitFor();
    assert.equal(await page.getByText('登录后可见的初始评论正文', {exact: true}).count(), 0);
    assert.equal(await page.getByRole('textbox').count(), 0);
    assert.deepEqual((await state(page)).requests.filter(request => request.name.startsWith('comments:')).map(request => request.name), ['comments:getSummary'], 'Anonymous comments request only the two public counts');
    const articleLike = page.getByRole('button', {name: '喜欢这篇文章', exact: true});
    assert.equal(await articleLike.textContent(), '0');
    await page.screenshot({path: join(tmpdir(), 'services-comments-anonymous-375.png'), fullPage: true});
    await articleLike.click();
    await page.getByText('登录后可见的初始评论正文', {exact: true}).waitFor();
    assert.equal((await state(page)).writes.filter(write => write.name === 'comments:setLike').length, 0, 'The anonymous heart opens login without writing an anonymous reaction');
    assert.equal(await page.getByRole('textbox', {name: '公开昵称'}).count(), 0, 'Comment author names are supplied by the authenticated account');
    const body = page.getByRole('textbox', {name: '你的评论', exact: true});
    const submit = page.getByRole('button', {name: '发布评论', exact: true});
    const original = page.locator('#comment-comment_initial');
    const commentLike = original.getByRole('button', {name: '喜欢 测试读者 的评论', exact: true});
    for (const button of [articleLike, commentLike]) {
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      assert.equal(await button.textContent(), '1');
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      assert.equal(await button.textContent(), '0');
    }
    await commentLike.click();
    await body.fill('<script>window.__unsafe = true</script>');
    await submit.click();
    await page.getByText('<script>window.__unsafe = true</script>', {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => window.__unsafe), undefined);
    await page.getByText('2 条评论', {exact: true}).waitFor();
    assert.equal((await state(page)).comments.find(comment => comment.body.startsWith('<script>')).authorName, 'fixture-a-username');
    assert.equal((await state(page)).writes.filter(write => write.name === 'comments:add').some(write => 'authorName' in write.args), false, 'The client cannot choose or spoof a comment author name');
    await original.getByRole('button', {name: '回复', exact: true}).click();
    await body.fill('这是针对初始评论的回复。');
    await submit.click();
    await page.getByText('这是针对初始评论的回复。', {exact: true}).waitFor();
    assert.equal((await state(page)).writes.filter(write => write.name === 'comments:add').at(-1).args.parentId, 'comment_initial');
    await page.getByText('3 条评论', {exact: true}).waitFor();
    const fileInput = page.locator('input[type="file"]');
    assert.equal(await fileInput.getAttribute('multiple'), '');
    assert.equal(await fileInput.getAttribute('accept'), 'image/jpeg,image/png,image/webp,image/gif');
    const uploadButton = page.getByRole('button', {name: '添加图片', exact: true});
    const composer = page.locator('.blog-comments__composer');
    await page.addStyleTag({content: `
      .services-comments { width: 100%; max-width: 100%; background: var(--body-background); color: var(--body-font-color); }
      :root[data-theme="dark"] { --body-background: #17191c; --body-font-color: #e3e5e8; --color-link: #84b6ff; --gray-100: #23262b; --gray-200: #383b41; background: #17191c; }
    `});
    for (const theme of ['light', 'dark']) for (const width of [320, 416, 772]) {
      await page.setViewportSize({width, height: 900});
      await page.evaluate(theme => {document.documentElement.dataset.theme = theme; document.documentElement.dataset.bookTheme = theme;}, theme);
      await body.fill('图片可以补充讨论中的细节。');
      await page.mouse.move(width - 2, 2);
      const iconStyle = await uploadButton.evaluate(button => {
        const style = getComputedStyle(button), rect = button.getBoundingClientRect(), icon = button.querySelector('svg').getBoundingClientRect();
        return {text: button.textContent, width: rect.width, height: rect.height, background: style.backgroundColor, border: style.borderTopWidth, icon: [icon.width, icon.height]};
      });
      assert.deepEqual(iconStyle, {text: '', width: 40, height: 40, background: 'rgba(0, 0, 0, 0)', border: '0px', icon: [20, 20]}, 'Image upload stays an icon-only ghost action with a usable target');
      const inputBox = await uploadButton.boundingBox(), submitBox = await submit.boundingBox();
      assert.ok(Math.abs(inputBox.y + inputBox.height / 2 - submitBox.y - submitBox.height / 2) < 1, `${theme} ${width}px upload and publish stay on one aligned row`);
      assert.equal(await composer.locator('.drop-zone__description').evaluate(element => element.getBoundingClientRect().width), 1, 'The file limits remain accessible without occupying toolbar space');
      await page.evaluate(() => window.scrollTo({top: document.querySelector('.book-footer').getBoundingClientRect().top + scrollY - 120, behavior: 'instant'}));
      await uploadButton.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => scrollY > 0), 'Tooltip regression covers an already scrolled article');
      const layoutBeforeHover = await page.evaluate(() => {
        const selectors = ['.services-comments', '.book-footer', '.blog-comments__root', '.blog-comments__composer', '.blog-comments__uploads', '.blog-comments__submit', '.drop-zone__trigger', '.blog-comments__submit > button'];
        window.__commentLayout = () => ({rects: selectors.map(selector => {const {x, y, width, height} = document.querySelector(selector).getBoundingClientRect(); return {selector, x, y, width, height};}), scroll: [scrollX, scrollY, document.documentElement.scrollWidth, document.documentElement.scrollHeight]});
        window.__commentLayouts = [];
        const record = () => {window.__commentLayouts.push(window.__commentLayout()); window.__commentLayoutFrame = requestAnimationFrame(record);};
        window.__commentLayoutFrame = requestAnimationFrame(record);
        return window.__commentLayout();
      });
      await uploadButton.hover();
      const tip = page.getByRole('tooltip').filter({hasText: '添加图片 · 最多 4 张，每张 5 MB'});
      await tip.waitFor();
      await tip.evaluate(async element => {await Promise.all(element.getAnimations({subtree: true}).map(animation => animation.finished));});
      const layoutDuringHover = await page.evaluate(() => window.__commentLayout());
      assert.deepEqual(layoutDuringHover, layoutBeforeHover, 'Opening the upload tooltip cannot move the form, actions or surrounding document');
      assert.equal(await tip.evaluate(element => getComputedStyle(element).opacity), '1', 'Upload help has reached its readable state before visual inspection');
      const tipBox = await tip.boundingBox();
      assert.ok(tipBox.x >= 0 && tipBox.x + tipBox.width <= width + 1, 'Upload help fits the viewport');
      if (width === 320) await page.screenshot({path: join(tmpdir(), `services-comments-upload-tooltip-${theme}-${width}.png`), fullPage: true});
      await page.keyboard.press('Escape');
      await tip.waitFor({state: 'hidden'});
      const hoverLayouts = await page.evaluate(() => {cancelAnimationFrame(window.__commentLayoutFrame); return [...window.__commentLayouts, window.__commentLayout()];});
      assert.ok(hoverLayouts.length > 2, 'The hover regression samples multiple frames, including the portal mount and removal');
      for (const layout of hoverLayouts) assert.deepEqual(layout, layoutBeforeHover, 'Tooltip mount, positioning, animation and dismissal preserve all layout and scroll measurements');
      await body.focus();
      for (let step = 0; step < 3 && !await uploadButton.evaluate(button => document.activeElement === button); step++) await page.keyboard.press('Tab');
      assert.equal(await uploadButton.evaluate(button => document.activeElement === button), true, 'The upload control is reachable from the comment field by keyboard');
      const focusLayout = await page.evaluate(() => window.__commentLayout());
      await tip.waitFor();
      assert.deepEqual(await page.evaluate(() => window.__commentLayout()), focusLayout, 'Keyboard help does not move the layout');
      await page.keyboard.press('Escape');
      await tip.waitFor({state: 'hidden'});
      assert.deepEqual(await page.evaluate(() => window.__commentLayout()), focusLayout, 'Dismissing keyboard help preserves its scroll position and surrounding layout');
      await body.focus();
      const picker = page.waitForEvent('filechooser');
      await uploadButton.click();
      await (await picker).setFiles(imageFile(`${theme}-${width}.png`));
      await page.getByRole('img', {name: '待发布图片 1', exact: true}).waitFor();
      await page.getByRole('img', {name: '待发布图片 1', exact: true}).evaluate(image => image.decode());
      await page.getByRole('status', {name: '已选择 1 张图片，最多 4 张'}).waitFor();
      assert.equal(uploadRequests.length, 0, 'The icon opens the actual file picker and keeps selection local until publish');
      const countBox = await composer.locator('.blog-comments__image-count').boundingBox();
      assert.ok(countBox.x + countBox.width < (await page.locator('.blog-comments__submit').boundingBox()).x, 'The selected image count stays clear of the character count and publish action');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${theme} ${width}px comments have no horizontal overflow`);
      await page.mouse.move(width - 2, 2);
      await composer.screenshot({path: join(tmpdir(), `services-comments-upload-${theme}-${width}.png`)});
      await page.getByRole('button', {name: '移除图片 1', exact: true}).click();
      assert.equal(await composer.locator('.blog-comments__image-count').count(), 0);
    }
    await page.setViewportSize({width: 375, height: 900});
    await page.evaluate(() => {document.documentElement.dataset.theme = 'light'; document.documentElement.dataset.bookTheme = 'light';});
    await body.fill('');
    console.log('Comment upload toolbar: icon-only picker, hover/keyboard help, selected count and one-row layout passed at 320/416/772px in light/dark themes; real Book footer geometry and scrolled-document positions remain identical through tooltip mount/animation/removal.');
    await fileInput.setInputFiles(imageFile('preview.png'));
    await page.getByRole('button', {name: '移除图片 1', exact: true}).waitFor();
    assert.equal(uploadRequests.length, 0, 'Selecting an image previews locally until the comment is published');
    await page.getByRole('button', {name: '移除图片 1', exact: true}).click();
    assert.equal((await state(page)).writes.filter(write => write.name === 'commentImages:discard').length, 0, 'Removing a local-only preview needs no storage write');
    await fileInput.setInputFiles({name: 'oversize.gif', mimeType: 'image/gif', buffer: Buffer.alloc(5 * 1024 * 1024 + 1)});
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button', {name: '移除图片 1', exact: true}).count(), 0, 'A file over 5 MiB is rejected before preview/upload');
    assert.equal(uploadRequests.length, 0);

    await body.fill('带图片的草稿在失败后必须保留。');
    await fileInput.setInputFiles(imageFile('retry.png'));
    imageNetwork.failNextUpload = true;
    const addsBeforeUploadFailure = (await state(page)).writes.filter(write => write.name === 'comments:add').length;
    await submit.click();
    await page.getByText('上传失败，再次发布可重试。', {exact: true}).waitFor();
    assert.equal(await body.inputValue(), '带图片的草稿在失败后必须保留。');
    assert.equal(await page.getByRole('button', {name: '移除图片 1', exact: true}).count(), 1);
    assert.equal((await state(page)).writes.filter(write => write.name === 'comments:add').length, addsBeforeUploadFailure, 'A failed upload does not publish a partial comment');
    await page.evaluate(() => window.__services.failNextComment());
    await submit.click();
    await page.getByRole('alert').filter({hasText: '评论未能发布，你的文字和图片仍保留在这里，请稍后重试。'}).waitFor();
    assert.equal(await body.inputValue(), '带图片的草稿在失败后必须保留。');
    assert.equal((await state(page)).commentImages.filter(image => !image.attached).length, 1);
    const uploadsBeforeSaveRetry = uploadRequests.length;
    imageNetwork.failNextImageRead = true;
    await submit.click();
    await page.getByText('带图片的草稿在失败后必须保留。', {exact: true}).waitFor();
    assert.equal(uploadRequests.length, uploadsBeforeSaveRetry, 'Retrying the comment save reuses its uploaded image');
    assert.equal(await body.inputValue(), '');
    assert.equal(await page.getByRole('button', {name: '移除图片 1', exact: true}).count(), 0);
    await page.getByText('4 条评论', {exact: true}).waitFor();
    await page.getByRole('alert').filter({hasText: '图片暂时无法加载'}).waitFor();
    await page.getByRole('button', {name: '重新加载图片', exact: true}).click();
    const publishedImage = page.getByRole('button', {name: '查看图片 1', exact: true});
    await publishedImage.click();
    const imageDialog = page.getByRole('dialog', {name: '评论图片', exact: true});
    await imageDialog.waitFor();
    await imageDialog.locator('img').evaluate(image => image.decode());
    assert.deepEqual(await imageDialog.locator('img').evaluate(image => [image.naturalWidth, image.naturalHeight]), [480, 240], 'The comment landscape image retains its original dimensions');
    assert.equal(await imageDialog.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true, 'Published images open a decodable full-size image');
    assert.ok(imageReads.length > 0 && imageReads.every(request => request.method === 'GET' && request.authorization === 'Bearer fixture-session-token'),
      'Published comment images are loaded through authenticated fetch, never as anonymous storage URLs');
    assert.match(await imageDialog.locator('img').getAttribute('src'), /^blob:/, 'The modal renders the authenticated response as a local object URL');
    await page.screenshot({path: join(tmpdir(), 'services-comment-image-375.png'), fullPage: true});
    await imageDialog.getByRole('button', {name: '关闭图片', exact: true}).click();
    await imageDialog.waitFor({state: 'hidden'});

    await fileInput.setInputFiles(imageFile('discard.png'));
    await page.evaluate(() => window.__services.failNextComment());
    await submit.click();
    await page.getByRole('alert').filter({hasText: '评论未能发布，你的文字和图片仍保留在这里，请稍后重试。'}).waitFor();
    const discardedImage = (await state(page)).commentImages.find(image => !image.attached).id;
    await page.getByRole('button', {name: '移除图片 1', exact: true}).click();
    await page.waitForFunction(imageId => !window.__services.getState().commentImages.some(image => image.id === imageId), discardedImage);
    assert.equal((await state(page)).writes.filter(write => write.name === 'commentImages:discard').at(-1).args.imageId, discardedImage);
    await fileInput.setInputFiles(imageFile('image-only.png', 'portrait'));
    await submit.click();
    await page.getByText('5 条评论', {exact: true}).waitFor();
    const imageOnly = (await state(page)).comments[0];
    assert.equal(imageOnly.body, '', 'A comment can contain an image without body text');
    assert.equal(imageOnly.imageIds.length, 1);
    assert.ok(uploadRequests.every(request => request.method === 'POST' && request.authorization === 'Bearer fixture-session-token' && request.contentType === 'image/png' && [imageBytes.length, imageFixtures.get('portrait').length].includes(request.size)),
      'Each image upload uses the authenticated raw-file endpoint and correct content type');

    await fileInput.setInputFiles([1, 2, 3, 4].map(index => imageFile(`draft-${index}.png`, index % 2 ? 'landscape' : 'portrait')));
    await page.getByRole('button', {name: '移除图片 4', exact: true}).waitFor();
    const uploadCountBeforeFifth = uploadRequests.length;
    await fileInput.setInputFiles(imageFile('fifth.png'));
    assert.equal(await page.getByRole('button', {name: '移除图片 5', exact: true}).count(), 0, 'A comment draft never accepts more than four images');
    assert.equal(uploadRequests.length, uploadCountBeforeFifth);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Comments and four-image previews fit a 375px viewport');
    await page.screenshot({path: join(tmpdir(), 'services-comments-draft-375.png'), fullPage: true});
    for (const width of [1000, 390]) {
      await page.setViewportSize({width, height: 900});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Comment image drafts fit ${width}px`);
      await page.screenshot({path: join(tmpdir(), `services-comments-draft-${width}.png`), fullPage: true});
    }
    await page.setViewportSize({width: 375, height: 900});
    await body.fill('评论未保存草稿');
    await switchSession(page, 'fixture-b', 'session-b');
    await body.waitFor();
    assert.equal(await body.inputValue(), '');
    assert.equal(await page.getByRole('button', {name: '移除图片 1', exact: true}).count(), 0, 'Image drafts are cleared when the account changes');
    assert.equal(await commentLike.getAttribute('aria-pressed'), 'false', 'A new account sees its own like state');
    assert.equal(await commentLike.textContent(), '1', 'The aggregate like count remains public across accounts');
    await switchSession(page, 'fixture-no-username', 'session-no-username');
    await page.getByText('设置用户名', {exact: true}).waitFor();
    assert.equal(await page.getByText('Fixture User', {exact: true}).count(), 0, 'Missing username never falls back to the private Clerk full name');
    assert.equal(await page.getByText('当前账户', {exact: true}).count(), 0, 'The composer asks for a username instead of a generic account label');
    await body.fill('缺少用户名时保留的草稿。');
    await submit.click();
    await page.getByRole('alert').filter({hasText: '请先设置用户名，再发布评论。'}).waitFor();
    assert.equal(await body.inputValue(), '缺少用户名时保留的草稿。');
    await page.getByRole('textbox', {name: '用户名', exact: true}).fill('ab');
    await page.getByRole('button', {name: '保存用户名', exact: true}).click();
    await page.getByRole('alert').filter({hasText: '用户名须为 4–64 个字符'}).waitFor();
    await page.getByRole('textbox', {name: '用户名', exact: true}).fill('fixture-a-username');
    await page.getByRole('button', {name: '保存用户名', exact: true}).click();
    await page.getByRole('alert').filter({hasText: '这个用户名已被使用，请换一个。'}).waitFor();
    await page.getByRole('textbox', {name: '用户名', exact: true}).fill('new-reader');
    await submit.click();
    await page.getByText('缺少用户名时保留的草稿。', {exact: true}).waitFor();
    assert.equal((await state(page)).comments[0].authorName, 'new-reader');
    assert.equal((await state(page)).writes.filter(write => write.name === 'comments:add').at(-1).args.authorName, undefined);
    await page.getByText('6 条评论', {exact: true}).waitFor();
    const before = (await state(page)).requests.filter(request => ['comments:list', 'comments:getMyLike'].includes(request.name)).length;
    const imageReadsBeforeSignOut = imageReads.length;
    await switchSession(page, null, null);
    await page.getByRole('button', {name: '登录 / 注册', exact: true}).waitFor();
    await page.getByText('6 条评论', {exact: true}).waitFor();
    assert.equal(await page.locator('.blog-comments__list').count(), 0);
    assert.equal(await page.locator('.blog-comments__images').count(), 0, 'Sign-out removes all comment image viewers');
    assert.equal(imageReads.length, imageReadsBeforeSignOut, 'Sign-out starts no anonymous image fetch');
    assert.equal((await state(page)).requests.filter(request => ['comments:list', 'comments:getMyLike'].includes(request.name)).length, before, 'Sign-out hides comment content without requesting a private list or like state');
    await page.evaluate(() => {location.hash = '#comment-comment_initial';});
    await page.getByRole('button', {name: '登录 / 注册', exact: true}).click();
    await page.waitForFunction(() => document.activeElement?.id === 'comment-comment_initial');
    await assertClientCleanup(page);
    console.log('Comments: public counts only while anonymous; authenticated article/comment likes, account username, safe replies and session isolation.');
  } finally {await context.close();}
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
