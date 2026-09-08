import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321';
const url = new URL('/demos/2026/threejs-basics/', base).href;
const origin = new URL(base).origin;
const screenshots = process.env.BLOG_SCREENSHOT_DIR;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];

async function createContext(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    ...options,
  });
  await context.route(/https:\/\/(?:giscus\.app|www\.googletagmanager\.com|pagead2\.googlesyndication\.com)\//, (route) => route.abort());
  return context;
}

async function createPage(context, label) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
  page.on('response', (response) => {
    if (new URL(response.url()).origin === origin && response.status() >= 400) {
      errors.push(`${label}: ${response.status()} ${response.url()}`);
    }
  });
  return page;
}

async function assertFits(page, label) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no document horizontal overflow`);
}

async function assertAlignment(root, label) {
  const layout = await root.evaluate((element) => {
    const rect = (node) => {
      const bounds = node.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, height: bounds.height, centerY: bounds.top + bounds.height / 2 };
    };
    const choices = [...element.querySelectorAll('[data-slot="radio-content"]')].map((choice) => {
      const text = choice.querySelector('[data-slot="label"]');
      const textRange = document.createRange();
      textRange.selectNodeContents(text);
      const visibleText = textRange.getBoundingClientRect();
      return {
        card: rect(choice), control: rect(choice.querySelector('[data-slot="radio-control"]')), label: rect(text),
        contentLeft: visibleText.left, contentRight: visibleText.right,
        overflow: choice.scrollWidth - choice.clientWidth,
      };
    });
    const switches = [...element.querySelectorAll('[data-slot="switch"]')].map((toggle) => ({
      row: rect(toggle.querySelector('[data-slot="switch-content"]')),
      control: rect(toggle.querySelector('[data-slot="switch-control"]')),
      label: rect(toggle.querySelector('[data-slot="label"]')),
      help: rect(toggle.querySelector('p')),
    }));
    const trigger = element.querySelector('[data-slot="disclosure-trigger"]');
    const triggerStyle = getComputedStyle(trigger);
    const triggerBounds = rect(trigger);
    const stage = element.querySelector('[aria-label="3D 观察区域"]');
    const panel = element.querySelector('form');
    return {
      choices, switches,
      disclosure: {
        label: rect(trigger.firstElementChild), indicator: rect(trigger.querySelector('[data-slot="disclosure-indicator"]')),
        contentLeft: triggerBounds.left + parseFloat(triggerStyle.paddingLeft) + parseFloat(triggerStyle.borderLeftWidth),
        contentRight: triggerBounds.right - parseFloat(triggerStyle.paddingRight) - parseFloat(triggerStyle.borderRightWidth),
      },
      stacked: rect(panel).top >= rect(stage).bottom - 1,
      stackedStarts: [
        rect(stage.querySelector(':scope > [aria-hidden="true"]')).left,
        rect(element.querySelector('#three-camera-help strong')).left,
        rect(element.querySelector('#three-geometry-heading')).left,
      ],
    };
  });
  const aligned = (a, b, message) => assert.ok(Math.abs(a - b) <= 1, `${label}: ${message} (${a.toFixed(2)} vs ${b.toFixed(2)})`);
  assert.equal(layout.choices.length, 6, `${label}: six visible choices`);
  for (const [index, choice] of layout.choices.entries()) {
    aligned(choice.card.height, layout.choices[0].card.height, 'Radio options have equal heights');
    assert.ok(choice.card.height >= 44, `${label}: Radio options have usable touch targets`);
    assert.ok(choice.overflow <= 1 && choice.contentLeft >= choice.card.left - 1 && choice.contentRight <= choice.card.right + 1, `${label}: Radio option ${index + 1} contains its label and color swatch`);
    assert.ok(choice.control.left >= choice.card.left - 1 && choice.control.right <= choice.card.right + 1, `${label}: Radio indicator stays inside its option`);
    aligned(choice.control.centerY, choice.label.centerY, 'Radio indicators and labels share a vertical center');
    if (index >= 3) {
      aligned(choice.control.left, layout.choices[index - 3].control.left, 'Geometry and Material indicator columns align');
      aligned(choice.label.left, layout.choices[index - 3].label.left, 'Geometry and Material label columns align');
    }
  }
  assert.equal(layout.switches.length, 2);
  for (const toggle of layout.switches) {
    aligned(toggle.label.left, toggle.help.left, 'Switch labels and descriptions share a left edge');
    aligned(toggle.control.right, toggle.row.right, 'Switch controls sit at the trailing edge');
    aligned(toggle.control.right, layout.switches[0].control.right, 'Switch controls share a right edge');
    aligned(toggle.label.centerY, toggle.control.centerY, 'Switch labels and controls are vertically centered');
  }
  aligned(layout.disclosure.label.left, layout.disclosure.contentLeft, 'Code disclosure label aligns left');
  aligned(layout.disclosure.indicator.right, layout.disclosure.contentRight, 'Code disclosure indicator aligns right');
  aligned(layout.disclosure.label.centerY, layout.disclosure.indicator.centerY, 'Code disclosure contents are vertically centered');
  if (layout.stacked) {
    for (const start of layout.stackedStarts) aligned(start, layout.stackedStarts[0], 'Scene, Camera and panel labels share the stacked content edge');
  }
}

// Compare successive screenshots of the actual canvas, without a stored golden
// image. Waiting for stable frames accommodates OrbitControls damping and GPUs
// with different rendering speeds while still detecting a stopped render loop.
async function stableCanvas(canvas, label) {
  let previous;
  let consecutive = 0;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const current = await canvas.screenshot({ animations: 'disabled' });
    consecutive = previous?.equals(current) ? consecutive + 1 : 0;
    if (consecutive >= 3) return current;
    previous = current;
    await canvas.page().waitForTimeout(120);
  }
  assert.fail(`${label}: canvas did not settle after rotation was paused`);
}

async function changedCanvas(canvas, previous, label) {
  const current = await stableCanvas(canvas, label);
  assert.ok(!previous.equals(current), `${label}: changes the rendered canvas`);
  return current;
}

async function formState(root) {
  return root.locator('input').evaluateAll((inputs) => inputs.map((input) => ({
    type: input.type,
    value: input.value,
    checked: input.checked,
  })));
}

// HeroUI keeps the native form inputs accessible while its visible Label is the
// pointer target. Use that label for clicks and inspect the input's real state.
async function setControl(root, role, name, selected) {
  const control = root.getByRole(role, { name, exact: true });
  if (await control.isChecked() !== selected) {
    await root.getByText(name, { exact: true }).click();
  }
  assert.equal(await control.isChecked(), selected, `${name}: selection updated`);
  return control;
}

try {
  if (screenshots) await mkdir(screenshots, { recursive: true });
  const context = await createContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await createPage(context, 'desktop');
  await page.goto(url);
  const root = page.locator('[data-demo="threejs-basics"]');
  await page.locator('[data-demo="threejs-basics"][data-state="ready"]').waitFor();
  const canvas = root.getByLabel('可交互的 3D 场景', { exact: true });
  assert.equal(await canvas.evaluate((element) => element.tagName), 'CANVAS');
  assert.ok(await canvas.isVisible());
  await assertFits(page, '1440px');
  await assertAlignment(root, '1440px');

  const initialForm = await formState(root);
  const automatic = root.getByRole('switch', { name: '自动旋转', exact: true });
  const wireframe = root.getByRole('switch', { name: '显示线框', exact: true });
  const light = root.getByRole('slider', { name: 'Light 强度', exact: true });
  const reset = root.getByRole('button', { name: '重置场景', exact: true });
  const initiallyAutomatic = await automatic.isChecked();
  await setControl(root, 'switch', '自动旋转', false);
  let frame = await stableCanvas(canvas, 'initial scene');
  const initialFrame = frame;

  for (const name of ['立方体', '球体', '圆环']) {
    const radio = root.getByRole('radio', { name, exact: true });
    if (await radio.isChecked()) continue;
    await setControl(root, 'radio', name, true);
    assert.ok(await radio.isChecked(), `${name}: selected`);
    frame = await changedCanvas(canvas, frame, `Geometry ${name}`);
  }
  for (const name of ['湖蓝', '陶土', '苔绿']) {
    const radio = root.getByRole('radio', { name, exact: true });
    if (await radio.isChecked()) continue;
    await setControl(root, 'radio', name, true);
    assert.ok(await radio.isChecked(), `${name}: selected`);
    frame = await changedCanvas(canvas, frame, `Material ${name}`);
  }

  // Exercise the native slider through its keyboard interface, as a reader can.
  await light.focus();
  const previousLight = await light.inputValue();
  const minimum = await light.getAttribute('min') ?? '0';
  await light.press(previousLight === minimum ? 'End' : 'Home');
  assert.notEqual(await light.inputValue(), previousLight, 'Keyboard changes Light strength');
  frame = await changedCanvas(canvas, frame, 'Light strength');
  await setControl(root, 'switch', '显示线框', !await wireframe.isChecked());
  frame = await changedCanvas(canvas, frame, 'Wireframe');

  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  assert.ok(bounds && bounds.width > 100 && bounds.height > 100, 'Canvas has usable dimensions');
  await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.65, { steps: 12 });
  await page.mouse.up();
  frame = await changedCanvas(canvas, frame, 'Pointer drag changes Camera');

  await canvas.focus();
  await canvas.press('ArrowLeft');
  frame = await changedCanvas(canvas, frame, 'Keyboard ArrowLeft changes Camera');
  await canvas.press('Shift+Equal');
  frame = await changedCanvas(canvas, frame, 'Keyboard plus zooms Camera');

  await setControl(root, 'switch', '自动旋转', true);
  let rotating = false;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !rotating) {
    await page.waitForTimeout(150);
    rotating = !frame.equals(await canvas.screenshot({ animations: 'disabled' }));
  }
  assert.ok(rotating, 'Automatic rotation changes the rendered scene');
  await setControl(root, 'switch', '自动旋转', false);
  const paused = await stableCanvas(canvas, 'Pause animation');
  await page.waitForTimeout(350);
  assert.ok(paused.equals(await canvas.screenshot({ animations: 'disabled' })), 'Pause keeps the rendered scene still');

  await reset.click();
  assert.deepEqual(await formState(root), initialForm, 'Reset restores all initial controls');
  await setControl(root, 'switch', '自动旋转', false);
  const resetFrame = await stableCanvas(canvas, 'Reset');
  if (!initiallyAutomatic) {
    assert.ok(resetFrame.equals(initialFrame), 'Reset restores the initial Camera and scene');
  }

  // Arrow navigation must work for the native radio group without pointer input.
  const cube = root.getByRole('radio', { name: '立方体', exact: true });
  await setControl(root, 'radio', '立方体', true);
  const beforeKeyboard = await stableCanvas(canvas, 'Before keyboard Geometry');
  await cube.focus();
  await cube.press('ArrowRight');
  assert.ok(await root.getByRole('radio', { name: '球体', exact: true }).isChecked(), 'Keyboard changes Geometry');
  await changedCanvas(canvas, beforeKeyboard, 'Keyboard Geometry');

  const codeToggle = root.getByRole('button', { name: '查看对应代码', exact: true });
  assert.equal(await codeToggle.getAttribute('aria-expanded'), 'false', 'Scene code starts collapsed');
  await codeToggle.click();
  const source = root.locator('pre code');
  await source.waitFor();
  assert.match(await source.innerText(), /mesh\.geometry = geometries\.sphere;/, 'Expanded code describes the selected Geometry');
  await setControl(root, 'radio', '圆环', true);
  await source.filter({ hasText: 'geometries.torus' }).waitFor();
  assert.match(await source.innerText(), /mesh\.geometry = geometries\.torus;/, 'Visible code follows Geometry changes');
  const expectedSource = await source.textContent();
  await page.evaluate(() => navigator.clipboard.writeText('threejs-demo-copy-test'));
  await root.getByRole('button', { name: '复制场景代码', exact: true }).click();
  await page.waitForFunction(async (expected) => await navigator.clipboard.readText() === expected, expectedSource);
  const copiedSource = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(copiedSource, expectedSource, 'Copy writes the currently displayed scene code to the clipboard');
  assert.match(copiedSource, /geometries\.torus;/, 'Copied code contains the current Geometry');
  assert.match(copiedSource, /material\.color\.set\('#257f81'\)/, 'Copied code contains the current Material');
  await codeToggle.click();
  assert.equal(await codeToggle.getAttribute('aria-expanded'), 'false', 'Scene code can be collapsed again');

  const back = page.getByRole('link', { name: /返回.*(?:文章|指南)/ }).first();
  assert.ok(await back.isVisible(), 'Demo links back to the article');
  assert.match(await back.getAttribute('href'), /threejs-and-blender-guide\/?(?:#.*)?$/);
  await reset.click();
  await setControl(root, 'switch', '自动旋转', false);
  await stableCanvas(canvas, 'Desktop screenshot');
  if (screenshots) await page.screenshot({ path: join(screenshots, 'threejs-basics-desktop.png'), fullPage: true });

  // Leave the page and load a new React island, as a reader reopening the demo
  // would. DOM removal outside React is not part of the supported lifecycle.
  await page.goto('about:blank');
  await page.goto(url);
  await page.locator('[data-demo="threejs-basics"][data-state="ready"]').waitFor();
  assert.equal(await root.locator('canvas').count(), 1, 'Reopening the demo mounts exactly one Canvas');
  const reopenedFrame = await stableCanvas(canvas, 'Reopened scene');
  await setControl(root, 'radio', '陶土', true);
  await changedCanvas(canvas, reopenedFrame, 'Material after reopening');
  assert.equal(await root.getAttribute('data-state'), 'ready', 'Reopened scene stays ready after rendering');
  await reset.click();
  await setControl(root, 'switch', '自动旋转', false);

  await page.setViewportSize({ width: 375, height: 850 });
  await assertFits(page, '375px');
  await assertAlignment(root, '375px');
  await stableCanvas(canvas, 'Mobile resize');
  const mobileBounds = await canvas.boundingBox();
  assert.ok(mobileBounds && mobileBounds.width <= 375 && mobileBounds.width > 100, 'Mobile canvas fits the viewport');
  await setControl(root, 'radio', '陶土', true);
  assert.ok(await root.getByRole('radio', { name: '陶土', exact: true }).isChecked(), 'Mobile controls remain usable');
  await codeToggle.click();
  await source.waitFor();
  assert.match(await source.innerText(), /#c66a48/, 'Mobile code describes the selected Material');
  await assertFits(page, '375px with expanded code');
  await codeToggle.click();
  if (screenshots) await page.screenshot({ path: join(screenshots, 'threejs-basics-mobile.png'), fullPage: true });

  for (const width of [768, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await assertFits(page, `${width}px`);
    await assertAlignment(root, `${width}px`);
    await stableCanvas(canvas, `${width}px resize`);
    if (screenshots) await page.screenshot({ path: join(screenshots, `threejs-basics-${width}.png`), fullPage: true });
  }
  await context.close();

  const fallbackContext = await createContext();
  await fallbackContext.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return Reflect.apply(original, this, [type, ...args]);
    };
  });
  const fallback = await createPage(fallbackContext, 'no WebGL');
  await fallback.goto(url);
  const failedRoot = fallback.locator('[data-demo="threejs-basics"][data-state="error"]');
  await failedRoot.waitFor();
  assert.match(await failedRoot.innerText(), /WebGL/);
  assert.match(await failedRoot.innerText(), /无法|不支持/);
  const unavailable = [
    ...await failedRoot.getByRole('radio').all(),
    ...await failedRoot.getByRole('switch').all(),
    failedRoot.getByRole('slider', { name: 'Light 强度', exact: true }),
    failedRoot.getByRole('button', { name: '重置场景', exact: true }),
  ];
  assert.equal(unavailable.length, 10, 'Fallback preserves every scene control');
  for (const control of unavailable) assert.ok(await control.isDisabled(), 'Unavailable 3D controls are disabled');
  assert.ok(await fallback.getByRole('link', { name: /返回.*(?:文章|指南)/ }).first().isVisible(), 'Fallback preserves article navigation');
  if (screenshots) await fallback.screenshot({ path: join(screenshots, 'threejs-basics-no-webgl.png'), fullPage: true });
  await fallbackContext.close();

  const noJsContext = await createContext({ javaScriptEnabled: false });
  const noJs = await createPage(noJsContext, 'no JavaScript');
  await noJs.goto(url);
  const staticRoot = noJs.locator('[data-demo="threejs-basics"]');
  assert.match(await staticRoot.innerText(), /Geometry/);
  assert.match(await staticRoot.innerText(), /Material/);
  assert.match((await noJs.locator('noscript').allInnerTexts()).join('\n'), /JavaScript/);
  assert.ok(await noJs.getByRole('link', { name: /返回.*(?:文章|指南)/ }).first().isVisible(), 'Without JavaScript, explanations and article navigation remain available');
  await noJsContext.close();

  assert.deepEqual(errors, [], 'No uncaught browser errors or failed local assets');
  console.log('Three.js demo: rendered controls, Camera drag, animation/pause, reset, keyboard input, reactive code disclosure, page reopening, desktop/mobile layout, WebGL fallback and no-JavaScript content passed.');
} finally {
  await browser.close();
}
