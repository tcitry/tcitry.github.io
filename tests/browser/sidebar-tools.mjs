import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Run against an already built preview. This test never rebuilds shared assets.
const base = new URL(process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321');
const browser = await chromium.launch({headless: true});
const appearance = '[data-blog-theme-trigger]';
const search = '[data-blog-search-trigger]';
const popover = '[data-blog-theme-popover]';

async function settle(page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => {})));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function ready(page, width) {
  await page.waitForFunction(() => document.querySelector('[data-sidebar-tools]')?.closest('astro-island')?.hasAttribute('ssr') === false);
  if (width < 768 && !await page.locator('#menu-control').isChecked()) {
    await page.locator('.book-header label[for="menu-control"]').click();
  }
  await page.locator(appearance).waitFor({state: 'visible'});
}

async function openAppearance(page) {
  await page.locator(appearance).click();
  await page.locator(popover).waitFor({state: 'visible'});
  await settle(page);
}

async function expectTheme(page, value, dark) {
  await page.waitForFunction(({value, dark}) => document.documentElement.dataset.bookTheme === value
    && document.documentElement.classList.contains('dark') === dark, {value, dark});
  const names = {auto: '跟随系统', light: '浅色', dark: '深色'};
  await page.waitForFunction(({selector, name}) => document.querySelector(selector)?.getAttribute('aria-label') === `外观：${name}`,
    {selector: appearance, name: names[value]});
  assert.equal(await page.evaluate(() => localStorage.getItem('astro-book-theme')), value, 'Theme preference is persisted');
}

async function expectFocus(page, selector) {
  await page.waitForFunction((selector) => document.activeElement?.matches(selector), selector);
}

try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({viewport: {width, height: 900}, colorScheme: 'light', serviceWorkers: 'block',
      isMobile: width < 768, hasTouch: width < 768});
    await context.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    const failures = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (new URL(response.url()).origin === base.origin && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });
    try {
      await page.goto(new URL('/weekly/', base).href, {waitUntil: 'load'});
      await ready(page, width);
      assert.equal(await page.locator('[data-book-theme-select]').count(), 0, 'The old select is absent');
      assert.equal(await page.locator('[data-sidebar-tools]').count(), 1, 'The sidebar has one shared toolbar');
      assert.equal(await page.locator(`${search} input`).count(), 0, 'The search entry is an action, not an input');
      assert.equal(await page.locator(search).getAttribute('aria-label'), '搜索博客');
      assert.equal(await page.locator(search).getAttribute('aria-haspopup'), 'dialog');
      assert.equal(await page.locator(search).getAttribute('aria-keyshortcuts'), 'Meta+K Control+K');
      const bounds = await page.evaluate(({search, appearance}) => {
        const bar = document.querySelector('[data-sidebar-tools]').getBoundingClientRect();
        const first = document.querySelector(search).getBoundingClientRect();
        const last = document.querySelector(appearance).getBoundingClientRect();
        const searchIcon = document.querySelector(`${search} svg`).getBoundingClientRect();
        const svg = document.querySelector(`${appearance} svg`).getBoundingClientRect();
        const archives = [...document.querySelectorAll('.book-menu-content a')].find((link) => link.textContent.includes('Archives'))?.getBoundingClientRect();
        return {
          sameRow: Math.abs(first.top - last.top) < 1 && Math.abs(first.height - last.height) < 1,
          fit: first.left >= bar.left - 1 && last.right <= bar.right + 1 && last.left >= first.right,
          square: Math.abs(last.width - last.height) < 1,
          visibleIcon: svg.width > 10 && svg.width < last.width && svg.height > 10 && svg.height < last.height,
          documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
          // The search frame extends up to 4px into the sidebar padding so its
          // inset icon follows the navigation's visual start, not the frame.
          alignNavIcon: Boolean(archives) && Math.abs(searchIcon.left - archives.left) <= 3,
          navFrameOutset: Boolean(archives) && first.left >= archives.left - 5 && first.left <= archives.left + 1,
        };
      }, {search, appearance});
      assert.deepEqual(bounds, {sameRow: true, fit: true, square: true, visibleIcon: true, documentFits: true, alignNavIcon: true, navFrameOutset: true});

      await openAppearance(page);
      assert.equal(await page.getByRole('menuitemradio').count(), 3, 'All three appearance modes are available');
      assert.equal(await page.getByRole('menuitemradio', {name: '跟随系统', exact: true}).getAttribute('aria-checked'), 'true');
      const menuFits = await page.locator(popover).evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1;
      });
      assert.equal(menuFits, true, 'The appearance popover fits the viewport');
      await page.keyboard.press('Escape');
      await page.locator(popover).waitFor({state: 'hidden'});
      await expectFocus(page, appearance);
      if (width < 768) assert.equal(await page.locator('#menu-control').isChecked(), true, 'Closing the appearance popover preserves the mobile drawer');

      for (const [value, name, dark] of [['dark', '深色', true], ['light', '浅色', false], ['auto', '跟随系统', false]]) {
        await openAppearance(page);
        await page.getByRole('menuitemradio', {name, exact: true}).click();
        await page.locator(popover).waitFor({state: 'hidden'});
        await expectTheme(page, value, dark);
        await expectFocus(page, appearance);
        await openAppearance(page);
        assert.equal(await page.getByRole('menuitemradio', {name, exact: true}).getAttribute('aria-checked'), 'true');
        assert.equal(await page.locator('[role="menuitemradio"][aria-checked="true"]').count(), 1, 'Only the saved mode is selected');
        await page.keyboard.press('Escape');
        await page.locator(popover).waitFor({state: 'hidden'});
      }
      await page.emulateMedia({colorScheme: 'dark'});
      await expectTheme(page, 'auto', true);
      await page.emulateMedia({colorScheme: 'light'});
      await expectTheme(page, 'auto', false);

      // Keyboard mode selection and persistence across a real page navigation.
      await page.locator(appearance).focus();
      await page.keyboard.press('ArrowDown');
      await page.locator(popover).waitFor({state: 'visible'});
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.locator(popover).waitFor({state: 'hidden'});
      await expectTheme(page, 'dark', true);
      await page.goto(new URL('/archives/', base).href, {waitUntil: 'load'});
      await ready(page, width);
      await expectTheme(page, 'dark', true);
      await page.reload({waitUntil: 'load'});
      await ready(page, width);
      await expectTheme(page, 'dark', true);

      // The hydrated HeroUI button must open the existing lazy command palette.
      for (const action of ['click', 'Enter', 'Space', 'Control+k', 'Meta+k']) {
        console.log(`Sidebar tools at ${width}px: opening search with ${action}.`);
        if (action === 'click') await page.locator(search).click();
        else {
          await page.locator(search).focus();
          await page.keyboard.press(action);
        }
        await page.locator('[data-blog-command]').waitFor({state: 'visible'});
        await expectFocus(page, '[data-blog-search-input]');
        await page.keyboard.press('Escape');
        await page.locator('[data-blog-command]').waitFor({state: 'hidden'});
        await expectFocus(page, search);
        if (width < 768) assert.equal(await page.locator('#menu-control').isChecked(), true, 'Closing search preserves the mobile drawer');
      }
      if (width === 1440) {
        // A real pointer move establishes pointer modality after keyboard navigation.
        // React Aria deliberately ignores hover restored by a closing keyboard overlay.
        await page.mouse.move(width - 20, 850);
        await page.locator(appearance).hover();
        await page.getByRole('tooltip', {name: '外观：深色'}).waitFor({state: 'visible'});
      }
      assert.deepEqual(errors, [], 'No browser runtime errors');
      assert.deepEqual(failures, [], 'No local HTTP failures');
      console.log(`Sidebar tools at ${width}px: layout, menus, themes, persistence, keyboard actions and focus passed.`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
