import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Real scrollbars script and CSS in isolated native scroll surfaces. No site
// build, account session, application fixture or external request is needed.
const bundle = await build({entryPoints: [new URL('../../src/scripts/floating-scrollbars.ts', import.meta.url).pathname],
  bundle: true, platform: 'browser', format: 'esm', write: false});
const css = await readFile(new URL('../../src/styles/floating-scrollbars.css', import.meta.url), 'utf8');
const theme = await readFile(new URL('../../node_modules/@tcitry/astro-book/src/styles/base.css', import.meta.url), 'utf8');
const lines = Array.from({length: 100}, (_, index) => `Line ${index + 1}: native scrolling remains available.`).join('\n');
const html = mode => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>:root{--font-size:16px;--scrollbar-thumb-active:#555b} ${theme}
body{margin:0;background:white} #probe{position:fixed;top:8px;left:8px;width:100px;height:20px;z-index:2;background:#eee}
main{padding:48px 24px 24px;min-width:0} .surface{display:block;box-sizing:border-box;width:min(300px,100%);height:180px;margin:0;border:2px solid #ccc;overflow:auto;scroll-behavior:auto;font:16px/24px monospace}
.surface:focus-visible{outline:2px solid blue} .tall{height:1000px;background:linear-gradient(#eee,#acf)} .wide{width:1400px;height:90px;background:linear-gradient(90deg,#eee,#acf)}
textarea.surface{resize:none} pre.surface{white-space:pre;padding:8px} #horizontal{overflow-y:hidden;height:120px}
dialog{width:min(400px,calc(100vw - 32px));max-height:calc(100vh - 64px);border:1px solid #aaa;padding:16px;background:white}dialog::backdrop{background:#0004}dialog .surface{width:100%}
${mode === 'root' ? 'main{height:2600px}' : ''}
</style><link rel="stylesheet" href="/scrollbars.css"></head><body><div id="probe">Layout probe</div><main>
${mode === 'nested' ? '<div id="area" class="surface" tabindex="0" aria-label="Scrollable region"><div class="tall"></div></div>' : ''}
${mode === 'textarea' ? `<textarea id="area" class="surface" aria-label="Long draft">${lines}</textarea>` : ''}
${mode === 'horizontal' ? '<div id="area" class="surface" tabindex="0" aria-label="Horizontal region"><div class="wide"></div></div>' : ''}
${mode === 'code' ? `<pre id="area" class="surface" tabindex="0" aria-label="Code"><code>${lines}\n${'long-code-line '.repeat(100)}</code></pre>` : ''}
${mode === 'modal' ? '<dialog id="modal"><div id="area" class="surface" tabindex="0" aria-label="Modal region"><div class="tall"></div></div></dialog>' : ''}
</main><script type="module">import '/scrollbars.js';
${mode === 'modal' ? "document.querySelector('dialog').showModal();" : ''}
document.documentElement.dataset.ready='true';</script></body></html>`;
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const url = new URL(request.url, 'http://fixture');
  if (url.pathname === '/scrollbars.js') {response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text);}
  else if (url.pathname === '/scrollbars.css') {response.setHeader('Content-Type', 'text/css'); response.end(css);}
  else {response.setHeader('Content-Type', 'text/html'); response.end(html(url.searchParams.get('mode') ?? 'short'));}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const thumbs = page => page.locator('.blog-scroll-thumb');
const visibleThumb = (page, axis = 'y') => page.locator(`.blog-scroll-thumb[data-axis="${axis}"][data-visible]:not([hidden])`);
const errors = [];

async function open(browser, width, mode) {
  const page = await browser.newPage({viewport: {width, height: 998}});
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(`${mode}/${width}: ${error.message}`));
  await page.addInitScript(() => {
    window.__scrollbarTiming = {scroll: 0, released: 0};
    document.addEventListener('scroll', () => {window.__scrollbarTiming.scroll = performance.now();}, {capture: true, passive: true});
    document.addEventListener('pointerup', () => {window.__scrollbarTiming.released = performance.now();}, {capture: true, passive: true});
  });
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(`${base}/?mode=${mode}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.equal(await thumbs(page).count(), 0, `${mode}: no thumb before scrolling`);
  return page;
}

async function layout(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const area = document.querySelector('#area');
    const rect = element => {
      const {x, width, height} = element.getBoundingClientRect();
      return {x, width, height};
    };
    const dimensions = area ? {box: rect(area), clientWidth: area.clientWidth, clientHeight: area.clientHeight,
      scrollWidth: area.scrollWidth, scrollHeight: area.scrollHeight} : undefined;
    return {innerWidth, clientWidth: root.clientWidth, rootWidth: root.getBoundingClientRect().width,
      scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight, probe: rect(document.querySelector('#probe')), dimensions};
  });
}

async function checkVisible(page, before, axis = 'y', modal = false) {
  const thumb = visibleThumb(page, axis);
  await thumb.waitFor();
  await page.waitForFunction(axis => {
    const element = document.querySelector(`.blog-scroll-thumb[data-axis="${axis}"][data-visible]:not([hidden])`);
    return element && Number(getComputedStyle(element).opacity) > .95;
  }, axis);
  assert.deepEqual(await layout(page), before, 'Showing the floating thumb never changes content dimensions');
  const state = await thumb.evaluate(element => {
    const b = element.getBoundingClientRect();
    return {hiddenFromAT: element.getAttribute('aria-hidden'), tabIndex: element.tabIndex, modal: Boolean(element.closest('dialog:modal')),
      fits: b.left >= 0 && b.top >= 0 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1,
      exposed: element.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2))};
  });
  assert.deepEqual(state, {hiddenFromAT: 'true', tabIndex: -1, modal, fits: true, exposed: true});
  return thumb;
}

async function checkHide(page, before) {
  await page.waitForTimeout(200);
  assert.ok(await page.locator('.blog-scroll-thumb[data-visible]:not([hidden])').count() > 0, 'A thumb remains visible briefly after scrolling');
  await page.waitForFunction(() => [...document.querySelectorAll('.blog-scroll-thumb')].every(element => !element.hasAttribute('data-visible')));
  const fade = await page.evaluate(() => ({at: performance.now(), after: performance.now() - Math.max(window.__scrollbarTiming.scroll, window.__scrollbarTiming.released)}));
  assert.ok(fade.after >= 600 && fade.after <= 1000, `The idle fade starts near 650ms after the last scroll/release (observed ${Math.round(fade.after)}ms)`);
  await page.waitForFunction(() => document.querySelectorAll('.blog-scroll-thumb').length === 0);
  const removal = await page.evaluate(() => performance.now());
  assert.ok(removal - fade.at >= 100 && removal - fade.at <= 400, 'Removal follows the short opacity fade, not an immediate layout operation');
  assert.deepEqual(await layout(page), before, 'Hiding/removing the thumb never changes content dimensions');
}

let browser;
try {
  browser = await chromium.launch({headless: true});
  for (const width of [320, 375, 757, 916, 1016, 1440]) {
    const short = await open(browser, width, 'short');
    assert.deepEqual(await short.evaluate(() => ({client: document.documentElement.clientWidth, viewport: innerWidth, root: document.documentElement.getBoundingClientRect().width})),
      {client: width, viewport: width, root: width}, `A short page reserves no root gutter at ${width}px`);
    await short.mouse.wheel(0, 100);
    await short.waitForTimeout(100);
    assert.equal(await thumbs(short).count(), 0, 'A non-scrollable short page has no unnecessary thumb');
    await short.close();

    const page = await open(browser, width, 'root');
    const before = await layout(page);
    assert.equal(before.clientWidth, width); assert.equal(before.rootWidth, width); assert.equal(before.scrollWidth, width);
    await page.mouse.move(100, 100); await page.mouse.wheel(0, 240);
    await page.waitForFunction(() => scrollY > 0);
    await checkVisible(page, before);
    await checkHide(page, before);
    const previous = await page.evaluate(() => scrollY);
    await page.keyboard.press('PageDown');
    await page.waitForFunction(previous => scrollY > previous, previous);
    await checkVisible(page, before);
    // Root dragging must retain the native page scroll position and range.
    const thumb = visibleThumb(page);
    const box = await thumb.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const dragStart = await page.evaluate(() => scrollY);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 70, {steps: 4});
    await page.waitForFunction(previous => scrollY > previous, dragStart);
    await page.waitForTimeout(850);
    assert.equal(await thumb.isVisible(), true, 'Dragging keeps the thumb alive beyond its idle deadline');
    await page.mouse.up();
    await checkHide(page, before);
    await page.close();
    console.log(`Root ${width}px: zero gutter, wheel/keyboard/drag, transient thumb and unchanged layout.`);
  }

  for (const width of [320, 757]) for (const mode of ['nested', 'textarea', 'horizontal', 'code', 'modal']) {
    const page = await open(browser, width, mode);
    const area = page.locator('#area');
    const before = await layout(page);
    const axis = mode === 'horizontal' ? 'x' : 'y';
    await area.focus();
    const key = axis === 'x' ? 'ArrowRight' : 'PageDown';
    await page.keyboard.press(key);
    await page.waitForFunction(axis => document.querySelector('#area')[axis === 'x' ? 'scrollLeft' : 'scrollTop'] > 0, axis);
    const thumb = await checkVisible(page, before, axis, mode === 'modal');
    const box = await thumb.boundingBox();
    const start = await area.evaluate((element, axis) => element[axis === 'x' ? 'scrollLeft' : 'scrollTop'], axis);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + (axis === 'x' ? 30 : 0), box.y + box.height / 2 + (axis === 'y' ? 24 : 0), {steps: 4});
    await page.mouse.up();
    assert.ok(await area.evaluate((element, {axis, start}) => element[axis === 'x' ? 'scrollLeft' : 'scrollTop'] > start, {axis, start}), `${mode}: thumb dragging scrolls the native region`);
    await checkHide(page, before);
    // Teardown removes visible overlays and handlers before an Astro page swap.
    await area.evaluate((element, axis) => {element[axis === 'x' ? 'scrollLeft' : 'scrollTop'] = 1;}, axis);
    await visibleThumb(page, axis).waitFor();
    await page.evaluate(() => document.dispatchEvent(new Event('astro:before-swap')));
    assert.equal(await thumbs(page).count(), 0);
    await area.evaluate(element => {element.scrollTop += 20; element.scrollLeft += 20;});
    await page.waitForTimeout(50);
    assert.equal(await thumbs(page).count(), 0, 'A cleaned-up runtime never paints more overlays');
    await page.close();
    console.log(`${mode} ${width}px: keyboard/drag, modal stacking where applicable, idle removal and no layout shift.`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
