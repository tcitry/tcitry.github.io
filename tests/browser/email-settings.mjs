import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const artifacts = '/opt/cursor/artifacts';
const cacheDir = await mkdtemp(join(tmpdir(), 'email-settings-vite-'));
await mkdir(artifacts, {recursive: true});
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [react(), tailwind()],
  optimizeDeps: {entries: ['tests/fixtures/services-ui.html']},
  resolve: {alias: [
    {find: /^convex\/react$/, replacement: fixture('services-convex.tsx')},
    {find: /^convex\/react-clerk$/, replacement: fixture('services-convex.tsx')},
    {find: /^@clerk\/react$/, replacement: fixture('reader-clerk.tsx')},
    {find: /^@convex-dev\/agent\/react$/, replacement: fixture('services-agent.tsx')},
  ]},
  define: {
    'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('fixture-public-key'),
    'import.meta.env.PUBLIC_CONVEX_URL': JSON.stringify('https://fixture.convex.cloud'),
  },
  server: {host: '127.0.0.1', port: 0},
  logLevel: 'warn',
});

const myTab = (page, name) => page.getByRole('radiogroup', {name: '我的内容分类', exact: true}).getByRole('radio', {name, exact: true});
const switchMetrics = async (page, name) => page.evaluate((label) => {
  const root = [...document.querySelectorAll('[data-slot="switch"]')].find(node => node.textContent?.includes(label));
  if (!root) return null;
  const content = root.querySelector('[data-slot="switch-content"]');
  const control = root.querySelector('[data-slot="switch-control"]');
  const thumb = root.querySelector('[data-slot="switch-thumb"]');
  const description = root.querySelector('[data-slot="description"]');
  const labelEl = root.querySelector('[data-slot="label"]');
  const rootBox = root.getBoundingClientRect();
  const controlBox = control?.getBoundingClientRect();
  const labelBox = labelEl?.getBoundingClientRect();
  const descriptionBox = description?.getBoundingClientRect();
  const contentBox = content?.getBoundingClientRect();
  const style = control ? getComputedStyle(control) : null;
  const thumbStyle = thumb ? getComputedStyle(thumb) : null;
  return {
    controlWidth: controlBox?.width ?? 0,
    controlHeight: controlBox?.height ?? 0,
    controlBackground: style?.backgroundColor ?? '',
    thumbWidth: thumb?.getBoundingClientRect().width ?? 0,
    checked: root.getAttribute('data-selected') === 'true' || root.getAttribute('aria-checked') === 'true',
    controlRightAligned: controlBox ? Math.abs(rootBox.right - controlBox.right) < 6 : false,
    descriptionUnderLabel: descriptionBox && labelBox ? descriptionBox.top >= labelBox.bottom - 2 : false,
    descriptionAlignedWithLabel: descriptionBox && labelBox ? Math.abs(descriptionBox.left - labelBox.left) < 4 : false,
    verticallyCentered: controlBox && contentBox
      ? Math.abs((controlBox.top + controlBox.height / 2) - (contentBox.top + contentBox.height / 2)) < 10
      : false,
  };
}, name);

try {
  await server.listen();
  const base = new URL(server.resolvedUrls.local[0]);
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 440, height: 860}, serviceWorkers: 'block'});
  await context.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(new URL('/tests/fixtures/services-ui.html', base).href);
  await page.locator('.assistant-workspace__switcher').getByRole('radio', {name: '我的', exact: true}).waitFor();
  await myTab(page, '邮件通知').click();
  await page.locator('[data-slot="switch"]').filter({hasText: '启用邮件通知'}).waitFor();

  const masterOff = await switchMetrics(page, '启用邮件通知');
  assert.ok(masterOff && masterOff.controlWidth >= 28 && masterOff.controlHeight >= 12, 'master switch renders a visible track');
  assert.ok(masterOff.thumbWidth >= 8, 'master switch renders a visible thumb');
  assert.ok(masterOff.controlRightAligned, 'switch control aligns to the row end');
  assert.ok(masterOff.descriptionUnderLabel && masterOff.descriptionAlignedWithLabel, 'description sits under the label without indent');
  assert.ok(masterOff.verticallyCentered, 'switch control stays vertically centered with the text block');
  await page.screenshot({path: join(artifacts, 'email-settings-off.png'), fullPage: true});

  await page.evaluate(() => window.__services.setEmailPreferences('fixture-a', {
    enabled: true, commentReply: true, likes: false, newsletter: true,
  }));
  await page.waitForFunction(() => {
    const root = [...document.querySelectorAll('[data-slot="switch"]')].find(node => node.textContent?.includes('评论回复'));
    return root?.getAttribute('data-selected') === 'true' || root?.getAttribute('aria-checked') === 'true';
  });
  const replyOn = await switchMetrics(page, '评论回复');
  assert.ok(replyOn?.checked, 'comment reply switch can be on');
  assert.notEqual(replyOn?.controlBackground, 'rgba(0, 0, 0, 0)', 'checked track has a background color');
  await page.screenshot({path: join(artifacts, 'email-settings-on.png'), fullPage: true});

  await page.evaluate(() => window.__services.setEmailPreferences('fixture-a', {emailDisabled: true}));
  await page.getByRole('alert').filter({hasText: '邮件通知已暂停'}).waitFor();
  const disabled = await page.locator('[data-slot="switch"]').filter({hasText: '评论回复'}).evaluate(node => node.getAttribute('data-disabled') === 'true' || node.matches(':disabled'));
  assert.equal(disabled, true, 'category switches disable when email is suspended');
  await page.screenshot({path: join(artifacts, 'email-settings-disabled.png'), fullPage: true});

  await page.evaluate(() => window.__readerAuth.switchSession('fixture-author', 'session-author'));
  await myTab(page, '邮件通知').click();
  await page.locator('[data-slot="switch"]').filter({hasText: '新评论'}).waitFor();
  assert.equal(await page.locator('[data-slot="switch"]').filter({hasText: '新评论'}).count(), 1, 'site admin sees new comment switch');
  await page.evaluate(() => window.__readerAuth.switchSession('fixture-a', 'session-a'));
  await myTab(page, '邮件通知').click();
  assert.equal(await page.locator('[data-slot="switch"]').filter({hasText: '新评论'}).count(), 0, 'non-admin does not see new comment switch');

  console.log('Email settings UI: native HeroUI switches render with track/thumb in the real assistant panel.');
  await context.close();
  await browser.close();
} finally {
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
