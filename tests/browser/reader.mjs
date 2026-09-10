import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {join} from 'node:path';

const base = process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321';
const browser = await chromium.launch({headless: true});
async function settleLayout(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
}
try {
  // A fresh context never imports the user's browser login or performs writes.
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block'});
  await context.route(/https:\/\/(?:giscus\.app|www\.googletagmanager\.com|pagead2\.googlesyndication\.com)\//, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(20_000);
  await page.goto(new URL('/posts/this-blog/', base).href);
  const launcher = page.locator('[data-chat-launcher]');
  const expand = page.locator('[data-chat-expand]');
  const panel = page.locator('#blog-chat-panel');
  await expand.waitFor();
  assert.equal(await expand.getAttribute('aria-label'), '展开博客助手', 'The edge handle has an accessible action name');
  await launcher.click();
  assert.equal(await expand.isVisible(), false, 'Opening the panel hides the edge handle');
  await panel.locator('.assistant-workspace').waitFor();
  for (const name of ['AI 对话', '咨询', '我的', '消息']) {
    const tab = panel.getByRole('radio', {name, exact: true});
    await tab.click();
    assert.equal(await tab.getAttribute('aria-checked'), 'true');
    await panel.getByRole('heading', {name: '登录后继续', exact: true}).waitFor();
    assert.equal(await panel.locator('.assistant-workspace__actions').getByRole('button', {name: '登录 / 注册', exact: true}).count(), 1,
      `${name} preserves the shared header sign-in entry`);
    assert.equal(await panel.locator('.assistant-workspace__view').getByRole('button', {name: '登录 / 注册', exact: true}).count(), 1,
      `${name} offers sign-in in the authentication gate`);
    assert.equal(await panel.getByRole('textbox').count(), 0, `${name} has no anonymous composer`);
    assert.equal(await panel.locator('[data-reader-root], [data-reader-library], [data-consultations-panel], [data-personal-panel], [data-notifications], [data-my-comments], [data-liked-articles]').count(), 0,
      `${name} keeps private service UI unmounted until login`);
  }
  assert.equal(await panel.getByRole('radio', {name: '阅读', exact: true}).count(), 0, 'Personal services are grouped under 我的');
  assert.equal(await panel.getByRole('radio', {name: '会员', exact: true}).count(), 0, 'Membership is managed through the account menu');
  assert.equal(await panel.getByRole('radio', {name: '管理', exact: true}).count(), 0, 'Anonymous navigation has no author management entry');
  assert.equal(await panel.getByRole('tab', {name: /阅读进度|私有笔记/}).count(), 0);
  assert.equal(await page.locator('#main-content [data-reader-root]').count(), 0, 'Bookmark controls are confined to the circle panel');
  assert.equal(await page.locator('.book-menu a[href="/me/"], .book-menu a[href="/chat/"]').count(), 0);
  assert.equal(await page.locator('[data-blog-chat-widget]').getAttribute('data-reader-pathname'), '/posts/this-blog/');
  const closeButton = panel.getByRole('button', {name: '关闭博客助手', exact: true});
  const assertClosed = async (opener, description) => {
    await panel.waitFor({state: 'hidden'});
    await expand.waitFor();
    assert.equal(await panel.evaluate(element => element.open), false, description);
    assert.equal(await launcher.getAttribute('aria-expanded'), 'false');
    assert.equal(await expand.getAttribute('aria-expanded'), 'false');
    assert.equal(await opener.evaluate(element => document.activeElement === element), true, `${description}: focus returns to the actual opener`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${description}: the closed handle does not create overflow`);
  };
  const openFrom = async (opener, selectedView, width) => {
    await opener.click();
    await panel.waitFor();
    await settleLayout(page);
    assert.equal(await panel.getByRole('radio', {name: selectedView, exact: true}).getAttribute('aria-checked'), 'true', 'Reopening preserves the last selected service');
    assert.equal(await expand.isVisible(), false, 'The edge handle is hidden while its panel is open');
    assert.equal(await launcher.getAttribute('aria-expanded'), 'true');
    assert.equal(await expand.getAttribute('aria-expanded'), 'true');
    assert.equal(await panel.getAttribute('aria-modal'), String(width < 640));
    assert.equal(await panel.evaluate(element => element.matches(':modal')), width < 640, 'Small screens use the native modal dialog; desktop remains docked');
    assert.equal(await panel.evaluate(element => element.contains(document.activeElement)), true, 'Opening the panel moves keyboard focus into it');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `The open panel fits the ${width}px viewport`);
  };
  await panel.getByRole('radio', {name: '我的', exact: true}).click();
  await closeButton.click();
  await assertClosed(launcher, 'Closing the initial circle-opened panel');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({width, height: 900});
    await settleLayout(page);
    assert.equal(await launcher.isVisible(), true, 'The circle remains an available entry alongside the edge handle');
    const edgeBox = await expand.boundingBox();
    assert.ok(edgeBox && edgeBox.width > 0 && edgeBox.height > 0);
    assert.ok(Math.abs(edgeBox.x + edgeBox.width - width) <= 1, `The expand handle touches the right edge at ${width}px`);
    assert.ok(Math.abs(edgeBox.y + edgeBox.height / 2 - 450) <= 1, `The expand handle is vertically centered at ${width}px`);
    assert.equal(await expand.evaluate(element => getComputedStyle(element).position), 'fixed');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `The collapsed handle fits the ${width}px viewport`);
    if (process.env.BLOG_SCREENSHOT_DIR) await page.screenshot({path: join(process.env.BLOG_SCREENSHOT_DIR, `assistant-expand-${width}.png`)});
    if (width === 320) {
      const hint = expand.locator('.blog-chat-widget__tooltip');
      const assertHint = async (modality) => {
        await page.waitForFunction(() => {
          const element = document.querySelector('[data-chat-expand] .blog-chat-widget__tooltip');
          const style = element && getComputedStyle(element);
          return style?.visibility === 'visible' && Number(style.opacity) >= .99;
        });
        const hintBox = await hint.boundingBox();
        assert.ok(hintBox && hintBox.x >= 0 && hintBox.y >= 0 && hintBox.x + hintBox.width <= width && hintBox.y + hintBox.height <= 900,
          `The ${modality} expand tooltip fits the 320px viewport`);
        assert.ok(hintBox.x + hintBox.width <= edgeBox.x, `The ${modality} tooltip appears to the left of its handle`);
        assert.ok(Math.abs(hintBox.y + hintBox.height / 2 - edgeBox.y - edgeBox.height / 2) <= 1,
          `The ${modality} tooltip is centered beside its handle`);
        if (process.env.BLOG_SCREENSHOT_DIR) await page.screenshot({path: join(process.env.BLOG_SCREENSHOT_DIR, `assistant-expand-${modality}-320.png`)});
      };
      await expand.hover();
      await assertHint('hover');
      await page.mouse.move(20, 150);
      await launcher.focus();
      await page.keyboard.press('Tab');
      assert.equal(await expand.evaluate(element => document.activeElement === element && element.matches(':focus-visible')), true,
        'The edge handle follows the circle in keyboard order and has visible keyboard focus');
      await assertHint('focus');
      assert.equal(await panel.evaluate(element => element.open), false, 'Focusing the handle does not open the panel');
      await launcher.focus();
    }

    await openFrom(expand, '我的', width);
    await panel.getByRole('radio', {name: '咨询', exact: true}).click();
    if (process.env.BLOG_SCREENSHOT_DIR) await page.screenshot({path: join(process.env.BLOG_SCREENSHOT_DIR, `assistant-edge-open-${width}.png`)});
    await closeButton.click();
    await assertClosed(expand, `Close button after edge opening at ${width}px`);
    await openFrom(expand, '咨询', width);
    await page.keyboard.press('Escape');
    await assertClosed(expand, `Escape after edge opening at ${width}px`);

    await openFrom(launcher, '咨询', width);
    await panel.getByRole('radio', {name: '我的', exact: true}).click();
    await closeButton.click();
    await assertClosed(launcher, `Close button after circle opening at ${width}px`);
    await openFrom(launcher, '我的', width);
    await page.keyboard.press('Escape');
    await assertClosed(launcher, `Escape after circle opening at ${width}px`);
  }
  await page.goto(new URL('/', base).href);
  assert.equal(await page.locator('[data-open-reading]').count(), 0, 'Home has no alternate account launcher');
  assert.equal(await page.locator('[data-chat-launcher]').count(), 1, 'The circle remains a single shared entry');
  assert.equal(await page.locator('[data-chat-expand]').count(), 1, 'The right edge provides one entry to the same panel');
  assert.equal(await page.locator('[data-convex-comments], [data-giscus], .giscus').count(), 0, 'Home does not get a comment thread');
  await page.goto(new URL('/docs/', base).href);
  assert.equal(await page.locator('[data-reader-root]').count(), 0, 'Section indexes do not get article tools');
  assert.deepEqual(errors, []);
  console.log('Bookmarks browser checks passed: circle/edge entries, selected view persistence, focus restoration, mobile modality, login gates and responsive width.');
} finally {await browser.close();}
