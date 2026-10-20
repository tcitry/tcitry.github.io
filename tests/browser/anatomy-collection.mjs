import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';

const base = process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321';
const url = new URL('/docs/AI/Skills/anatomy-interactive-technical-illustrations/', base).href;
const screenshots = process.env.BLOG_SCREENSHOT_DIR;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];

async function open(options = {}, withoutWebGL = false) {
  const context = await browser.newContext({
    viewport: {width: 1440, height: 1000},
    reducedMotion: 'reduce',
    ...options,
  });
  if (withoutWebGL) {
    await context.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return /webgl/i.test(kind) ? null : original.call(this, kind, ...args);
      };
    });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  const study = page.locator('[data-demo="anatomy-collection-study"]');
  await study.scrollIntoViewIfNeeded();
  await study.locator('[data-anatomy-figure="anatomy-lru-cache"] svg').first().waitFor();
  return {context, page, study};
}

async function select(study, label, tag) {
  const started = Date.now();
  // Keyboard activation also verifies the selector without waiting for two
  // animation frames from the software GPU used in headless WebGL tests.
  const choice = study.getByRole('button', {name: label, exact: true});
  await choice.focus();
  await choice.press('Enter');
  const host = study.locator(`[data-anatomy-figure="anatomy-${tag}"]`);
  await host.locator('svg').first().waitFor();
  assert.equal(await study.locator('[data-anatomy-figure]').count(), 1, 'only one figure is mounted');
  console.log(`${tag}: selected in ${Date.now() - started}ms`);
  return host;
}

async function capture(study, name) {
  if (!screenshots) return;
  await mkdir(screenshots, {recursive: true});
  await study.evaluate(element => element.scrollIntoView({block: 'start'}));
  const clip = await study.evaluate(element => {
    const box = element.getBoundingClientRect();
    return {x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height};
  });
  await study.page().screenshot({path: join(screenshots, `anatomy-${name}.png`), fullPage: true, clip, animations: 'disabled'});
}

try {
  const {context, page, study} = await open();
  const lru = study.locator('[data-anatomy-figure="anatomy-lru-cache"]');
  const shelf = lru.getByRole('slider');
  for (const key of ['A', 'B', 'C', 'D', 'B', 'E']) {
    await shelf.press(key);
    await page.waitForFunction(key => {
      const host = document.querySelector('[data-anatomy-figure="anatomy-lru-cache"]');
      return host?.shadowRoot?.querySelector('[data-readout]')?.textContent?.includes(`get ${key}`);
    }, key);
  }
  assert.match(await lru.locator('[data-readout]').textContent(), /evicts A/);
  await capture(study, 'lru-light');

  const turbine = await select(study, 'WebGL · Turbofan', 'turbofan');
  await turbine.getByRole('slider').press('End');
  await page.waitForFunction(() => {
    const stage = document.querySelector('[data-anatomy-figure="anatomy-turbofan"]')?.shadowRoot?.querySelector('.iso-stage');
    return stage?.getAttribute('aria-valuenow') === '100';
  });
  assert.ok(await turbine.locator('canvas').count() > 0, 'the WebGL example has canvas layers');
  await turbine.locator('.iso-stage[data-gl]').waitFor();
  await turbine.locator('[data-readout]').filter({hasText: /334/}).waitFor();
  assert.match(await turbine.locator('[data-readout]').textContent(), /334/);
  await capture(study, 'turbofan-light');

  const seasons = await select(study, '3D · Seasons', 'seasons');
  const planet = seasons.getByRole('slider');
  await planet.press('Home');
  await seasons.locator('[data-readout]').filter({hasText: /16.*22/}).waitFor();
  assert.match(await seasons.locator('[data-readout]').textContent(), /16.*22/);
  await planet.press('End');
  await seasons.locator('[data-readout]').filter({hasText: /8.*04/}).waitFor();
  assert.match(await seasons.locator('[data-readout]').textContent(), /8.*04/);
  const beforeTurn = await seasons.locator('.iso-live').first().innerHTML();
  await planet.press('ArrowUp');
  await page.waitForFunction(before => {
    const host = document.querySelector('[data-anatomy-figure="anatomy-seasons"]');
    return host?.shadowRoot?.querySelector('.iso-live')?.innerHTML !== before;
  }, beforeTurn);
  assert.notEqual(await seasons.locator('.iso-live').first().innerHTML(), beforeTurn, '3D input changes projected geometry');
  await capture(study, 'seasons-light');

  const blur = await select(study, 'Early · Separable blur', 'separable-blur');
  const blurControl = blur.getByRole('slider');
  await blurControl.press('Home');
  await blur.locator('[role="slider"][aria-valuenow="0"]').waitFor();
  assert.equal(await blurControl.getAttribute('aria-valuenow'), '0');
  await blurControl.press('End');
  await blur.locator('[role="slider"][aria-valuenow="14"]').waitFor();
  assert.equal(await blurControl.getAttribute('aria-valuenow'), '14');
  await capture(study, 'blur-light');

  await page.evaluate(() => document.dispatchEvent(new CustomEvent('astro-book:set-theme', {detail: 'dark'})));
  await page.waitForFunction(() => {
    const host = document.querySelector('[data-anatomy-figure="anatomy-separable-blur"]');
    return !!host?.shadowRoot?.querySelector('.gk[data-theme="dark"]');
  });
  await capture(study, 'blur-dark');
  const darkLru = await select(study, 'SVG · LRU', 'lru-cache');
  await darkLru.locator('.iso[data-theme="dark"]').waitFor();
  await capture(study, 'lru-dark');
  await context.close();

  const mobile = await open({viewport: {width: 390, height: 844}});
  for (const [label, tag] of [
    ['SVG · LRU', 'lru-cache'],
    ['WebGL · Turbofan', 'turbofan'],
    ['3D · Seasons', 'seasons'],
    ['Early · Separable blur', 'separable-blur'],
  ]) {
    await select(mobile.study, label, tag);
    assert.ok(await mobile.study.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${tag}: study fits a phone`);
    assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tag}: page has no horizontal overflow`);
    await capture(mobile.study, `${tag}-phone`);
  }
  await mobile.context.close();

  const fallback = await open({}, true);
  const fallbackTurbine = await select(fallback.study, 'WebGL · Turbofan', 'turbofan');
  await fallbackTurbine.getByRole('slider').press('End');
  await fallbackTurbine.locator('[data-readout]').filter({hasText: /334/}).waitFor();
  assert.match(await fallbackTurbine.locator('[data-readout]').textContent(), /334/);
  assert.equal(await fallbackTurbine.locator('.iso-stage[data-gl]').count(), 0);
  assert.ok(await fallbackTurbine.locator('svg path').count() > 0, 'no-WebGL fallback retains the structure');
  const fallbackSeasons = await select(fallback.study, '3D · Seasons', 'seasons');
  await fallbackSeasons.getByRole('slider').press('End');
  await fallbackSeasons.locator('[data-readout]').filter({hasText: /8.*04/}).waitFor();
  assert.match(await fallbackSeasons.locator('[data-readout]').textContent(), /8.*04/);
  await capture(fallback.study, 'seasons-no-webgl');
  await fallback.context.close();

  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('Anatomy collection: causal controls, single mounting, themes, phone layout and no-WebGL fallback passed.');
} finally {
  await browser.close();
}
