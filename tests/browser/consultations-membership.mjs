import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'consultations-membership-'));
const screenshotDir = '/opt/cursor/artifacts/screenshots';
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [react(), tailwind()],
  optimizeDeps: {entries: ['tests/fixtures/consultations-membership-ui.tsx']},
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
try {
  await server.listen();
  await mkdir(screenshotDir, {recursive: true});
  const base = new URL(server.resolvedUrls.local[0]);
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 480, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  const panel = page.locator('[data-consultations-panel]');
  const open = (query = '') => page.goto(new URL(`/tests/fixtures/consultations-membership-ui.html${query}`, base).href);

  await open();
  await panel.getByText('等待博主回复。', {exact: true}).waitFor();
  assert.equal(await panel.getByText('Pro 会员可发起咨询，等待博主回复。', {exact: true}).count(), 0);
  assert.equal(await panel.getByRole('button', {name: '开通 Pro', exact: true}).count(), 0);
  assert.equal(await panel.getByRole('button', {name: '发起咨询', exact: true}).isDisabled(), false);
  await panel.screenshot({path: join(screenshotDir, 'consultations-pro-member.png')});

  await open('?failMembership=true');
  await panel.getByRole('alert').filter({hasText: '会员状态暂时无法读取，请稍后重试。'}).waitFor();
  assert.equal(await panel.getByRole('button', {name: '发起咨询', exact: true}).isDisabled(), true);
  assert.equal(await panel.getByRole('button', {name: '开通 Pro', exact: true}).count(), 0);
  assert.equal(await panel.getByText('私人咨询仅 Pro 会员可用。已有记录始终可查看。', {exact: true}).count(), 0);
  await panel.getByRole('button', {name: '重试', exact: true}).click();
  await panel.getByText('等待博主回复。', {exact: true}).waitFor();
  assert.equal(await panel.getByRole('button', {name: '发起咨询', exact: true}).isDisabled(), false);

  await open('?user=fixture-b');
  await panel.getByText('私人咨询仅 Pro 会员可用。已有记录始终可查看。', {exact: true}).waitFor();
  assert.equal(await panel.getByText('等待博主回复。', {exact: true}).count(), 0);
  assert.equal(await panel.getByText('私人咨询尚未开放。', {exact: true}).count(), 0);
  assert.equal(await panel.getByRole('button', {name: '发起咨询', exact: true}).count(), 0);
  const upgrade = panel.getByRole('button', {name: '开通 Pro', exact: true});
  await upgrade.waitFor();
  assert.equal(await upgrade.isDisabled(), false);
  await panel.getByRole('button', {name: /过期后仍可查看的咨询/}).waitFor();
  await panel.screenshot({path: join(screenshotDir, 'consultations-free-member.png')});
  await upgrade.click();
  const profile = page.getByRole('dialog', {name: 'Clerk 账户与订阅（测试）', exact: true});
  await profile.waitFor();
  assert.deepEqual((await page.evaluate(() => window.__servicesClerk.getState().profileRequests)).at(-1).options,
    {__experimental_startPath: '/billing'});
  await page.screenshot({path: join(screenshotDir, 'consultations-free-member-upgrade.png')});
  await profile.getByRole('button', {name: '关闭账户弹窗', exact: true}).click();
  await profile.waitFor({state: 'hidden'});

  await open('?plan=missing');
  await panel.getByText('私人咨询仅 Pro 会员可用。已有记录始终可查看。', {exact: true}).waitFor();
  assert.equal(await panel.getByText('私人咨询尚未开放。', {exact: true}).count(), 0);
  assert.equal(await panel.getByRole('button', {name: '发起咨询', exact: true}).count(), 0, 'A missing plan slug must not leave a disabled start button');
  const missingPlanUpgrade = panel.getByRole('button', {name: '开通 Pro', exact: true});
  await missingPlanUpgrade.waitFor();
  assert.equal(await missingPlanUpgrade.isDisabled(), false);
  await panel.screenshot({path: join(screenshotDir, 'consultations-missing-plan-slug.png')});
  await missingPlanUpgrade.click();
  const missingPlanProfile = page.getByRole('dialog', {name: 'Clerk 账户与订阅（测试）', exact: true});
  await missingPlanProfile.waitFor();
  assert.deepEqual((await page.evaluate(() => window.__servicesClerk.getState().profileRequests)).at(-1).options,
    {__experimental_startPath: '/billing'});
  await missingPlanProfile.getByRole('button', {name: '关闭账户弹窗', exact: true}).click();
  await missingPlanProfile.waitFor({state: 'hidden'});

  await open('?consult=off');
  await panel.getByText('私人咨询尚未开放。', {exact: true}).waitFor();
  assert.equal(await panel.getByRole('button', {name: '发起咨询', exact: true}).count(), 0, 'Global-off consultations have no fake start button');
  assert.equal(await panel.getByRole('button', {name: '开通 Pro', exact: true}).count(), 0);
  await panel.screenshot({path: join(screenshotDir, 'consultations-globally-off.png')});

  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Consultation membership: Pro start, failed check retry, free-user and missing-plan Billing upgrade, global-off without a fake start.');
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
