import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';

const base = process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321';
const screenshotDir = process.env.BLOG_SCREENSHOT_DIR;
const cases = [
  {name: 'mastra', path: '/docs/AI/Agents/mastra-agent-workflow-source-analysis/', demo: 'mastra-workflow-machine'},
  {name: 'ruflo', path: '/docs/AI/Agents/ruflo-agent-orchestration-source-analysis/', demo: 'ruflo-memory-window'},
  {name: 'heroui', path: '/docs/AI/Agents/heroui-agents-product-research/', demo: 'heroui-agent-composer'},
  {name: 'rakazo', path: '/docs/AI/Agents/rakazo-source-analysis/', demo: 'rakazo-effect-replay'},
];
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH});
const errors = [];

async function context(options = {}) {
  const result = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', ...options});
  // Optional ads/analytics do not participate in these local teaching models.
  await result.route(/https:\/\/(?:www\.googletagmanager\.com|pagead2\.googlesyndication\.com)\//, route => route.abort());
  return result;
}

async function open(ctx, entry, hydrate = true) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(`${entry.name}: ${error.message}`));
  await page.goto(new URL(entry.path, base).href, {waitUntil: 'domcontentloaded'});
  const root = page.locator(`[data-demo="${entry.demo}"]`);
  await root.scrollIntoViewIfNeeded();
  if (hydrate) await page.locator(`[data-demo="${entry.demo}"][data-hydrated="true"]`).waitFor();
  return {page, root};
}

async function waitAttribute(root, name, value) {
  await root.evaluate((element, {name, value}) => new Promise((resolve, reject) => {
    if (element.getAttribute(name) === value) return resolve();
    const deadline = setTimeout(() => {observer.disconnect();reject(new Error(`Timed out waiting for ${name}=${value}`));}, 20000);
    const observer = new MutationObserver(() => {
      if (element.getAttribute(name) === value) {clearTimeout(deadline);observer.disconnect();resolve();}
    });
    observer.observe(element, {attributes: true, attributeFilter: [name]});
  }), {name, value: String(value)});
}

async function json(root, selector) {
  return JSON.parse(await root.locator(selector).textContent());
}

async function keyActivate(button) {
  await button.focus();
  await button.press('Enter');
}

async function sliderValue(slider, value, minimum, step) {
  await slider.focus();
  await slider.press('Home');
  for (let index = 0; index < (value - minimum) / step; index++) await slider.press('ArrowRight');
  assert.equal(Number(await slider.inputValue()), value, 'keyboard changes the real Slider value');
}

async function fits(page, root, label) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no whole-page horizontal overflow`);
  assert.ok(await root.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${label}: component fits its container`);
}

async function capture(root, name) {
  if (!screenshotDir) return;
  await mkdir(screenshotDir, {recursive: true});
  await root.screenshot({path: join(screenshotDir, `${name}.png`), animations: 'disabled'});
}

async function mastra(root) {
  const slider = root.getByRole('slider');
  assert.equal(Number(await slider.inputValue()), 180);
  await keyActivate(root.getByRole('button', {name: '运行 Workflow', exact: true}));
  await waitAttribute(root, 'data-workflow-status', 'suspended');
  assert.deepEqual(await json(root, '[data-saved-payload]'), {amount: 180});
  assert.match(await root.locator('[data-counts]').textContent(), /normalize1 次[\s\S]*approval1 次[\s\S]*receipt0 次/);
  await sliderValue(slider, 60, 10, 10);
  assert.match(await root.locator('[data-frozen-comparison]').textContent(), /60[\s\S]*180/);
  await root.getByRole('button', {name: '拒绝 · false', exact: true}).click();
  await waitAttribute(root, 'data-workflow-status', 'success');
  assert.deepEqual(await json(root, '[data-resume-data]'), {approved: false});
  assert.equal(await root.locator('[data-resume-missing]').textContent(), 'false');
  assert.deepEqual(await json(root, '[data-approval-output]'), {amount: 180, decision: 'rejected'});
  assert.equal(await root.locator('[data-receipt]').textContent(), 'rejected:180.00');
  assert.match(await root.locator('[data-counts]').textContent(), /normalize1 次[\s\S]*approval2 次[\s\S]*receipt1 次/);
  await capture(root, 'mastra-rejected-180-desktop-light');
  await root.getByRole('button', {name: '重置为新运行', exact: true}).click();
  await sliderValue(slider, 100, 10, 10);
  await root.getByRole('button', {name: '运行 Workflow', exact: true}).click();
  await waitAttribute(root, 'data-workflow-status', 'success');
  assert.deepEqual(await json(root, '[data-approval-output]'), {amount: 100, decision: 'automatic'});
  assert.equal(await root.locator('[data-threshold-result]').textContent(), 'false');
  assert.equal(await root.locator('[data-receipt]').textContent(), 'automatic:100.00');
  assert.match(await root.locator('[data-counts]').textContent(), /normalize1 次[\s\S]*approval1 次[\s\S]*receipt1 次/);
}

async function resultIds(root) {
  return root.locator('[data-result]').evaluateAll(elements => elements.map(element => element.getAttribute('data-result')));
}

async function ruflo(root) {
  assert.equal(await root.getAttribute('data-current-position'), '1001');
  assert.match(await root.locator('[data-record-score="C"]').textContent(), /未执行评分/);
  assert.deepEqual(await resultIds(root), ['A', 'B']);
  await keyActivate(root.locator('[data-preset="inside"]'));
  await waitAttribute(root, 'data-current-position', '1000');
  assert.equal(await root.locator('[data-record-score="C"]').textContent(), '0.950');
  assert.deepEqual(await resultIds(root), ['C', 'A', 'B']);
  assert.equal(await root.locator('[data-boundary-rank="1000"]').getAttribute('data-record'), 'C');
  await capture(root, 'ruflo-inside-desktop-light');
  await root.locator('[data-preset="threshold"]').click();
  assert.deepEqual(await resultIds(root), ['A']);
  await root.locator('[data-preset="no-embedding"]').click();
  assert.deepEqual(await resultIds(root), ['B']);
  assert.equal(await root.locator('[data-record-score="B"]').textContent(), '0.400');
  await root.locator('[data-preset="inside"]').click();
  const namespace = root.getByRole('switch', {name: 'C 属于 patterns', exact: true});
  await namespace.focus();
  await namespace.press('Space');
  await waitAttribute(root, 'data-reason', 'namespace');
  assert.equal(await namespace.isChecked(), false);
  assert.match(await root.locator('[data-record-score="C"]').textContent(), /namespace 过滤/);
  assert.deepEqual(await resultIds(root), ['A', 'B']);
  await root.locator('[data-preset="no-embedding"]').click();
  await root.locator('[data-control="threshold"]').getByRole('slider').press('Home');
  assert.equal((await resultIds(root)).length, 10, 'zero threshold admits zero scores but still returns only Top 10');
  assert.equal((await resultIds(root))[0], 'B');
  assert.match(await root.textContent(), /1000 条通过 threshold，本次返回 10 条/);
}

async function choosePresentation(root, value) {
  await root.locator(`input[type="radio"][value="${value}"]`).check();
  await waitAttribute(root, 'data-presentation', value);
}

async function heroui(root) {
  const inputAppearance = await root.locator('input[type="radio"], input[type="checkbox"]').evaluateAll(inputs => inputs.map(input => ({appearance: getComputedStyle(input).appearance, width: input.getBoundingClientRect().width, height: input.getBoundingClientRect().height})));
  assert.equal(inputAppearance.length, 4);
  for (const input of inputAppearance) {
    assert.notEqual(input.appearance, 'none', 'native radio/checkbox must have a visible control');
    assert.ok(input.width >= 12 && input.height >= 12, 'native choice indicators retain a visible size');
  }
  assert.equal(await root.getAttribute('data-accepted'), 'true');
  assert.deepEqual(await root.locator('[data-bar] strong').allTextContents(), ['24', '42', '30', '54']);
  await keyActivate(root.getByRole('button', {name: '从第一行重放', exact: true}));
  await waitAttribute(root, 'data-received', '0');
  assert.deepEqual(await json(root, '[data-partial-spec]'), {});
  assert.equal(await root.locator('[data-composer-waiting]').count(), 1);
  for (let received = 1; received <= 4; received++) {
    await root.getByRole('button', {name: '接收下一行', exact: true}).click();
    await waitAttribute(root, 'data-received', received);
    const spec = await json(root, '[data-partial-spec]');
    assert.equal(spec.root, 'sales-layout');
    if (received === 1) assert.equal('elements' in spec, false);
    if (received === 2) assert.deepEqual(spec.elements, {});
    if (received === 3) {
      assert.deepEqual(spec.elements['sales-layout'].children, ['sales-view']);
      assert.equal(spec.elements['sales-view'], undefined);
      assert.match(await root.locator('[data-stream-status]').textContent(), /sales-view 仍未到达/);
    }
    if (received < 4) assert.equal(await root.locator('[data-bar]').count(), 0, 'unresolved references do not render stale UI');
    else {
      assert.equal(spec.elements['sales-view'].type, 'bar-chart');
      assert.deepEqual(await root.locator('[data-bar] strong').allTextContents(), ['24', '42', '30', '54']);
    }
  }
  await capture(root, 'heroui-complete-desktop-light');
  await root.getByRole('button', {name: '全为零', exact: true}).click();
  assert.deepEqual(await root.locator('[data-bar] strong').allTextContents(), ['0', '0', '0', '0']);
  assert.equal(await root.getAttribute('data-accepted'), 'true', 'zero values remain valid data');
  await choosePresentation(root, 'metric-grid');
  assert.match(await root.locator('[data-metric-total]').textContent(), /^0/);
  await root.getByRole('button', {name: '促销日', exact: true}).click();
  assert.match(await root.locator('[data-metric-total]').textContent(), /^216/);
  await choosePresentation(root, 'data-table');
  assert.deepEqual(await root.locator('[data-composer-result] tbody td').allTextContents(), ['72', '36', '60', '48']);
  await root.getByRole('button', {name: '按销量从高到低排序', exact: true}).click();
  assert.deepEqual(await root.locator('[data-composer-result] tbody td').allTextContents(), ['72', '60', '48', '36']);
  await root.getByRole('checkbox').check();
  await waitAttribute(root, 'data-accepted', 'false');
  assert.equal(await root.locator('[data-composer-result] table').count(), 0);
  assert.match(await root.locator('[data-composer-result]').textContent(), /没有渲染数据组件/);
  assert.match(await root.textContent(), /\/elements\/sales-view\/props\/rows\/0\/quantity/);
  await root.getByRole('button', {name: '恢复必需字段', exact: true}).click();
  await waitAttribute(root, 'data-accepted', 'true');
  assert.equal(await root.locator('[data-composer-result] tbody tr').count(), 4);
}

async function rakazo(root) {
  assert.equal(await root.locator('[data-gate-action]').textContent(), 'execute');
  const to = root.locator('[data-request-field="to"]');
  assert.match(await to.locator('td').nth(0).textContent(), /team@example\.test/);
  assert.match(await to.locator('td').nth(1).textContent(), /other@example\.test[\s\S]*未采用/);
  assert.match(await root.locator('[data-effective-field="to"]').textContent(), /team@example\.test[\s\S]*来自①/);
  const payload = await json(root, '[data-replay-output]');
  assert.equal(payload.to, 'team@example.test');
  await root.locator('[data-control="proposal"]').selectOption('team@example.test');
  assert.deepEqual(await json(root, '[data-replay-output]'), payload);
  await root.locator('[data-control="proposal"]').selectOption('other@example.test');
  assert.deepEqual(await json(root, '[data-replay-output]'), payload, 'new model recipient cannot overwrite persisted approval');
  await capture(root, 'rakazo-approved-desktop-light');
  await keyActivate(root.locator('[data-scenario="completed"]'));
  await waitAttribute(root, 'data-effect-status', 'completed');
  assert.deepEqual(await json(root, '[data-replay-output]'), {messageId: 'mail-42', delivered: true});
  assert.equal(await root.locator('[data-effective-field]').filter({hasText: '无执行参数'}).count(), 3);
  await root.locator('[data-scenario="executing"]').click();
  await waitAttribute(root, 'data-effect-status', 'executing');
  assert.equal(await root.locator('[data-gate-action]').textContent(), 'uncertain');
  assert.equal((await json(root, '[data-replay-output]')).uncertain, true);
  assert.match(await root.locator('[data-tool-calls]').textContent(), /0 次/);
  await root.locator('input[type="radio"][value="denied"]').check();
  assert.match((await json(root, '[data-replay-output]')).error, /user denied/);
  await root.locator('input[type="radio"][value="intended"]').check();
  assert.deepEqual(await json(root, '[data-replay-output]'), {paused: true});
  await root.locator('input[type="radio"][value="uncertain"]').check();
  assert.equal((await json(root, '[data-replay-output]')).uncertain, true);
  assert.match(await root.locator('[data-tool-calls]').textContent(), /0 次/);
}

try {
  const desktop = await context();
  for (const entry of cases) {
    const {page, root} = await open(desktop, entry);
    await ({mastra, ruflo, heroui, rakazo}[entry.name])(root);
    await fits(page, root, `${entry.name} desktop`);
    await page.close();
    console.log(`${entry.name}: semantic interaction and keyboard checks passed`);
  }
  await desktop.close();

  for (const [width, theme] of [[1440, 'dark'], [390, 'light'], [390, 'dark']]) {
    const ctx = await context({viewport: {width, height: 1000}, colorScheme: theme});
    for (const entry of cases) {
      const {page, root} = await open(ctx, entry);
      await page.evaluate(theme => document.dispatchEvent(new CustomEvent('astro-book:set-theme', {detail: theme})), theme);
      await page.waitForFunction(theme => document.documentElement.getAttribute('data-book-theme') === theme, theme);
      await fits(page, root, `${entry.name} ${width}px ${theme}`);
      // Retest one meaningful branch after resize/theme selection, with keyboard.
      if (entry.name === 'mastra') {
        await keyActivate(root.getByRole('button', {name: '运行 Workflow', exact: true}));
        await root.getByRole('button', {name: '批准 · true', exact: true}).click();
        assert.equal(await root.locator('[data-receipt]').textContent(), 'approved:180.00');
      } else if (entry.name === 'ruflo') {
        await keyActivate(root.locator('[data-preset="inside"]'));
        assert.equal(await root.locator('[data-record-score="C"]').textContent(), '0.950');
      } else if (entry.name === 'heroui') {
        await keyActivate(root.getByRole('button', {name: '从第一行重放', exact: true}));
        await keyActivate(root.getByRole('button', {name: '接收剩余行', exact: true}));
        assert.deepEqual(await root.locator('[data-bar] strong').allTextContents(), ['24', '42', '30', '54']);
      } else {
        await keyActivate(root.locator('[data-scenario="executing"]'));
        assert.equal((await json(root, '[data-replay-output]')).uncertain, true);
      }
      await fits(page, root, `${entry.name} ${width}px ${theme} changed`);
      await capture(root, `${entry.name}-${width}-${theme}`);
      await page.close();
    }
    await ctx.close();
  }

  const noScript = await context({javaScriptEnabled: false});
  for (const entry of cases) {
    const {page, root} = await open(noScript, entry, false);
    assert.equal(await root.getAttribute('data-hydrated'), 'false');
    if (entry.name === 'mastra') {
      assert.equal(await root.locator('[data-saved-payload]').textContent(), 'null');
      assert.match(await root.textContent(), /payload.amount[\s\S]*resumeData[\s\S]*output/);
    } else if (entry.name === 'ruflo') {
      assert.match(await root.locator('[data-record-score="C"]').textContent(), /未执行评分/);
      assert.deepEqual(await resultIds(root), ['A', 'B']);
    } else if (entry.name === 'heroui') {
      assert.deepEqual(await root.locator('[data-bar] strong').allTextContents(), ['24', '42', '30', '54']);
    } else {
      assert.equal((await json(root, '[data-replay-output]')).to, 'team@example.test');
      assert.match(await root.locator('[data-effective-field="to"]').textContent(), /来自①/);
    }
    assert.equal(await root.locator('fieldset:not([disabled])').count(), 0, `${entry.name}: no misleading live controls without JS`);
    await page.close();
  }
  await noScript.close();
  assert.deepEqual(errors, [], 'no page errors while interacting, resizing or changing themes');
  console.log('Anatomy blog mechanisms: semantic outputs, keyboard, themes, mobile and no-JS checks passed.');
} finally {
  await browser.close();
}
