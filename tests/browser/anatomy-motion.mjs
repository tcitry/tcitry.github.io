import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';

const base = process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321';
const screenshots = process.env.BLOG_SCREENSHOT_DIR;
const videos = process.env.BLOG_VIDEO_DIR;
const profile = process.env.BLOG_MOTION_PROFILE ?? 'all';
assert.ok(['all', 'desktop', 'responsive'].includes(profile), `Unknown motion profile: ${profile}`);
const allEntries = [
  {name: 'mastra', path: '/docs/AI/Agents/mastra-agent-workflow-source-analysis/', demo: 'mastra-workflow-machine', duration: 18,
    actor: '[data-workflow-motion="work"]', activity: '[data-workflow-motion="work"]', frames: [.18, .38, .62, .88]},
  {name: 'ruflo', path: '/docs/AI/Agents/ruflo-agent-orchestration-source-analysis/', demo: 'ruflo-memory-window', duration: 18,
    actor: '[data-memory-card="A"]', activity: '[data-memory-head]', frames: [.18, .38, .62, .88]},
  {name: 'heroui', path: '/docs/AI/Agents/heroui-agents-product-research/', demo: 'heroui-agent-composer', duration: 16,
    actor: '[data-value-token="0"]', activity: '[data-source-scan]', frames: [.18, .38, .62, .88]},
  {name: 'rakazo', path: '/docs/AI/Agents/rakazo-source-analysis/', demo: 'rakazo-effect-replay', duration: 14,
    actor: '[data-moving-request]', activity: '[data-moving-proposal]', frames: [.18, .38, .62, .88]},
];
const selectedNames = process.env.BLOG_MOTION_CASES?.split(',').map(name => name.trim()).filter(Boolean);
if (selectedNames) for (const name of selectedNames) assert.ok(allEntries.some(entry => entry.name === name), `Unknown motion case: ${name}`);
const entries = selectedNames ? allEntries.filter(entry => selectedNames.includes(entry.name)) : allEntries;
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH});
const errors = [];
const evidence = [];

async function makeContext(options = {}) {
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}, reducedMotion: 'no-preference', ...options});
  await context.route(/https:\/\/(?:www\.googletagmanager\.com|pagead2\.googlesyndication\.com)\//, route => route.abort());
  return context;
}

async function open(context, entry) {
  const videoStart = Date.now();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(`${entry.name}: ${error.message}`));
  await page.goto(new URL(entry.path, base).href, {waitUntil: 'domcontentloaded', timeout: 60000});
  const root = page.locator(`[data-demo="${entry.demo}"]`);
  const player = root.locator('[data-mechanism-player]').first();
  await player.scrollIntoViewIfNeeded();
  await root.locator('[data-mechanism-player][data-hydrated="true"]').first().waitFor();
  const stage = player.locator('[data-mechanism-stage]');
  for (let attempt = 0; attempt < 3; attempt++) {
    await stage.evaluate(node => node.scrollIntoView({block: 'center', behavior: 'instant'}));
    await page.waitForTimeout(150);
    if (await stage.evaluate(node => {const box = node.getBoundingClientRect();return box.top < innerHeight && box.bottom > 0;})) break;
  }
  await page.mouse.move(2, 2);
  return {context, page, root, player, stage, videoStart};
}
const progress = async scene => Number(await scene.stage.getAttribute('data-progress'));
const pause = async scene => {
  if (await scene.stage.getAttribute('data-playing') === 'true') await scene.player.locator('[data-motion-toggle]').click();
};

async function seek(scene, value) {
  // Native input event exercises the same controller as pointer scrubbing; a
  // separate real pointer drag below verifies the range's physical hit target.
  await scene.player.locator('[data-motion-seek]').evaluate((input, value) => {
    input.value = String(Math.round(value * 1000));
    input.dispatchEvent(new Event('input', {bubbles: true}));
  }, value);
  assert.ok(Math.abs(await progress(scene) - value) < .002, `seek reaches ${value}`);
  assert.equal(await scene.stage.getAttribute('data-playing'), 'false');
}

async function sampleActor(scene, selector) {
  return scene.stage.locator(selector).evaluate(node => {
    const box = node.getBoundingClientRect();
    return {transform: node.getAttribute('transform') ?? '', opacity: Number(getComputedStyle(node).opacity),
      x: box.x, y: box.y, width: box.width, height: box.height};
  });
}

async function capture(scene, suffix) {
  if (!screenshots) return;
  await mkdir(screenshots, {recursive: true});
  await scene.player.screenshot({path: join(screenshots, `${scene.entry.name}-${suffix}.png`)});
}

async function assertFits(scene, label) {
  assert.ok(await scene.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: document fits`);
  assert.ok(await scene.player.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${label}: figure fits`);
}

async function naturalCycle(scene) {
  const {entry} = scene;
  assert.equal(await scene.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), false);
  await scene.page.waitForFunction(demo => document.querySelector(`[data-demo="${demo}"] [data-mechanism-stage]`)?.dataset.playing === 'true', entry.demo);
  const actor = scene.stage.locator(entry.actor);
  await actor.evaluate(node => {window.__anatomyObservedActor = node;});
  const visibleTransforms = new Set();
  const visibleCenters = new Set();
  const samples = [];
  const taken = new Set();
  const started = Date.now();
  let max = 0;
  while (Date.now() - started < (entry.duration * 2 + 6) * 1000) {
    const p = await progress(scene);
    const state = await sampleActor(scene, entry.actor);
    assert.ok(await actor.evaluate(node => node === window.__anatomyObservedActor), `${entry.name}: same working object survives the motion`);
    const viewportState = await scene.stage.evaluate(node => ({playing: node.dataset.playing, top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, hidden: document.hidden}));
    samples.push({p, ...state, ...viewportState});
    if (state.opacity > .05 && state.width > 0 && state.height > 0) {
      visibleTransforms.add(state.transform);
      visibleCenters.add(`${state.x.toFixed(1)},${state.y.toFixed(1)}`);
    }
    for (const at of entry.frames) if (p >= at && !taken.has(at)) {taken.add(at);await capture(scene, `live-${Math.round(at * 100)}`);}
    max = Math.max(max, p);
    if (p >= .985) break;
    await scene.page.waitForTimeout(100);
  }
  if (screenshots) await writeFile(join(screenshots, `${entry.name}-samples.json`), JSON.stringify(samples, null, 2));
  assert.ok(max >= .985, `${entry.name}: normal page advances without a user starting it (max=${max.toFixed(4)}, samples=${samples.length}, elapsed=${Date.now() - started}ms)`);
  assert.ok(visibleTransforms.size >= 3 && visibleCenters.size >= 3, `${entry.name}: the visible object has at least three genuinely different intermediate positions (${visibleTransforms.size}/${visibleCenters.size})`);
  assert.ok(samples.some(sample => sample.p > .1 && sample.p < .9), `${entry.name}: samples include intermediate frames`);
  evidence.push({name: entry.name, visibleTransforms: visibleTransforms.size, visiblePositions: visibleCenters.size, samples});
  console.log(`${entry.name}: default 1× autoplay moves one visible actor through ${visibleCenters.size} positions`);
}

async function recordNaturalClip(scene, offset, duration, crop) {
  if (!videos) return;
  const raw = scene.page.video();
  await scene.context.close();
  const source = await raw.path();
  const target = join(videos, `${scene.entry.name}-normal-speed.mp4`);
  const even = value => Math.floor(value / 2) * 2;
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', offset.toFixed(3), '-i', source,
    '-t', duration.toFixed(3), '-an', '-vf', `crop=${even(crop.width)}:${even(crop.height)}:${even(crop.x)}:${even(crop.y)}`,
    '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target];
  const result = spawnSync(process.env.FFMPEG_PATH ?? 'ffmpeg', args, {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  console.log(`${scene.entry.name}: real-time clip ${target}`);
}

async function stationary(scene, reason, delay = 400) {
  const p = await progress(scene);
  const before = await sampleActor(scene, scene.entry.actor);
  await scene.page.waitForTimeout(delay);
  assert.equal(await progress(scene), p, `${scene.entry.name}: progress stops while ${reason}`);
  assert.deepEqual(await sampleActor(scene, scene.entry.actor), before, `${scene.entry.name}: actor stops while ${reason}`);
}

async function controls(scene) {
  const {player, stage, page, entry} = scene;
  await seek(scene, .35);
  await stationary(scene, 'manually paused');
  const scrub = player.locator('[data-motion-seek]');
  const box = await scrub.boundingBox();
  assert.ok(box && box.width >= 70);
  await page.mouse.move(box.x + 8 + (box.width - 16) * .35, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 8 + (box.width - 16) * .61, box.y + box.height / 2, {steps: 8});
  await page.mouse.up();
  assert.ok(Math.abs(await progress(scene) - .61) < .04, `${entry.name}: a real pointer drag scrubs the figure`);
  await stationary(scene, 'scrubbed');

  async function playFor(speed) {
    await seek(scene, .10);
    await player.locator('select').selectOption(String(speed));
    await player.locator('[data-motion-toggle]').click();
    const before = await progress(scene);
    await page.waitForTimeout(900);
    await pause(scene);
    return await progress(scene) - before;
  }
  const quarter = await playFor(.25);
  const full = await playFor(1);
  assert.ok(quarter > .003 && full > quarter * 2.4 && full < quarter * 5.5, `${entry.name}: 0.25× really slows the same motion (${quarter}/${full})`);

  await seek(scene, .25);
  await player.locator('[data-motion-toggle]').click();
  await page.waitForTimeout(200);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);
  assert.equal(await stage.getAttribute('data-playing'), 'false', `${entry.name}: offscreen observer stops autoplay`);
  await stationary(scene, 'offscreen');
  await stage.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  assert.equal(await stage.getAttribute('data-playing'), 'true', `${entry.name}: returns to playing after re-entry`);

  // Headless Chromium keeps background tabs visible. This explicitly tests the
  // application's visibilitychange handler, rather than claiming an OS-tab test.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await stage.getAttribute('data-playing'), 'false');
  await stationary(scene, 'visibilitychange reports document.hidden');
  await page.evaluate(() => {delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(150);
  assert.equal(await stage.getAttribute('data-playing'), 'true');
  await stage.focus();
  await stage.press('End');
  assert.equal(await progress(scene), 1);
  await stationary(scene, 'End holds the final pose', 2500);
  await capture(scene, 'manual-end');
}

async function causalFrames(scene) {
  const {entry, root, stage} = scene;
  if (entry.name === 'mastra') {
    await seek(scene, .70);
    assert.equal(await stage.locator('[data-workflow-motion="output-value"]').textContent(), '尚无');
    assert.equal(await stage.locator('[data-workflow-motion="imprint"]').getAttribute('opacity'), '0');
    await seek(scene, .77);
    assert.equal(await stage.locator('[data-workflow-motion="imprint"]').getAttribute('opacity'), '1');
    assert.match(await stage.locator('[data-workflow-motion="output-value"]').textContent(), /180.*rejected/);
    assert.equal(await stage.locator('[data-workflow-motion="receipt"]').getAttribute('opacity'), '0');
    await seek(scene, .98);
    assert.equal(await stage.getAttribute('data-workflow-receipt'), 'rejected:180.00');
    assert.equal(await stage.locator('[data-workflow-motion="counts"]').textContent(), '1 / 2 / 1');
    await root.locator('[data-scenario="automatic"]').click();
    await seek(scene, .98);
    assert.equal(await stage.getAttribute('data-workflow-receipt'), 'automatic:100.00');
    assert.equal(await stage.locator('[data-workflow-motion="decision"]').getAttribute('opacity'), '0');
  } else if (entry.name === 'ruflo') {
    await root.locator('[data-preset="outside"]').click();
    await seek(scene, .66);
    assert.equal(await stage.getAttribute('data-memory-painted-score'), 'unscored');
    const outsideC = await sampleActor(scene, '[data-memory-card="C"]');
    await seek(scene, .97);
    assert.equal((await sampleActor(scene, '[data-memory-card="C"]')).transform, outsideC.transform, 'window miss never becomes a travelling result');
    await root.locator('[data-preset="inside"]').click();
    const actor = stage.locator('[data-memory-card="C"]');
    await actor.evaluate(node => {window.__anatomyCandidateC = node;});
    const transforms = new Set();
    for (const at of [.08, .30, .50, .77, .88]) {
      await seek(scene, at);
      transforms.add((await sampleActor(scene, '[data-memory-card="C"]')).transform);
      assert.ok(await actor.evaluate(node => node === window.__anatomyCandidateC));
    }
    assert.ok(transforms.size >= 3, 'same C moves through window, scoring and ranked result');
    await seek(scene, .40);
    assert.equal(await stage.getAttribute('data-memory-painted-score'), 'unscored');
    await seek(scene, .66);
    assert.equal(await stage.getAttribute('data-memory-painted-score'), '0.95');
    assert.match(await stage.locator('[data-memory-live-order]').textContent(), /尚未接收/);
    await seek(scene, .95);
    assert.match(await stage.locator('[data-memory-live-order]').textContent(), /^C 0\.950/);
  } else if (entry.name === 'heroui') {
    await seek(scene, .45);
    assert.equal(await stage.getAttribute('data-motion-received'), '3');
    assert.equal(await stage.locator('[data-value-token="0"]').getAttribute('data-arrived'), 'false');
    await seek(scene, .54);
    assert.equal(await stage.getAttribute('data-motion-valid'), 'true');
    assert.equal(await stage.locator('[data-value-token="0"]').getAttribute('data-arrived'), 'false');
    await seek(scene, .90);
    assert.equal(await stage.locator('[data-value-token="0"]').getAttribute('data-arrived'), 'true');
    assert.deepEqual(await stage.locator('[data-token-number]').allTextContents(), ['24', '42', '30', '54']);
    await root.getByRole('checkbox').check();
    await seek(scene, .95);
    assert.equal(await stage.getAttribute('data-motion-valid'), 'false');
    assert.equal(await stage.locator('[data-value-token="0"]').getAttribute('data-stopped'), 'true');
    assert.equal(await stage.locator('[data-value-token="0"]').getAttribute('data-arrived'), 'false');
    await root.getByRole('checkbox').uncheck();
  } else {
    const original = await sampleActor(scene, '[data-retained-request]');
    await seek(scene, .70);
    assert.equal(await stage.locator('[data-arrival-readout]').getAttribute('data-arrived'), 'false');
    assert.equal(await stage.getAttribute('data-copy-arrived'), 'false');
    await seek(scene, .90);
    assert.equal(await stage.locator('[data-arrival-readout]').getAttribute('data-arrived'), 'true');
    assert.equal(await stage.getAttribute('data-replay-branch'), 'execution');
    assert.equal((await sampleActor(scene, '[data-retained-request]')).transform, original.transform, 'retained original does not move out with its working copy');
    assert.equal(JSON.parse(await root.locator('[data-replay-output]').textContent()).to, 'team@example.test');
    await root.locator('[data-scenario="completed"]').click();
    await seek(scene, .90);
    assert.equal(await stage.getAttribute('data-replay-branch'), 'return');
    assert.equal(JSON.parse(await root.locator('[data-replay-output]').textContent()).messageId, 'mail-42');
    await root.locator('[data-scenario="executing"]').click();
    await seek(scene, .90);
    assert.equal(await stage.getAttribute('data-replay-branch'), 'review');
    assert.equal(JSON.parse(await root.locator('[data-replay-output]').textContent()).uncertain, true);
  }
  console.log(`${entry.name}: contact/order, stable identity, pause, scrub, slow, offscreen, hidden handler and End checked`);
}

try {
  if (videos) await mkdir(videos, {recursive: true});
  for (const entry of profile === 'responsive' ? [] : entries) {
    const context = await makeContext(videos ? {recordVideo: {dir: join(videos, 'raw'), size: {width: 1280, height: 1000}}} : {});
    const scene = {...await open(context, entry), entry};
    const crop = await scene.player.boundingBox();
    const clipStart = (Date.now() - scene.videoStart) / 1000;
    await naturalCycle(scene);
    if (videos && entry.name === 'ruflo') {
      await scene.page.waitForFunction(demo => {
        const root = document.querySelector(`[data-demo="${demo}"]`);
        return root?.dataset.currentPosition === '1000' && Number(root.querySelector('[data-mechanism-stage]')?.dataset.progress) < .15;
      }, entry.demo);
      await naturalCycle(scene);
    }
    const clipDuration = (Date.now() - scene.videoStart) / 1000 - clipStart;
    if (videos) {
      // Finalize the uninterrupted normal-speed recording before the separate
      // control checks, so a selector failure cannot discard useful footage.
      await recordNaturalClip(scene, clipStart, clipDuration, crop);
      const controlsContext = await makeContext();
      const controlsScene = {...await open(controlsContext, entry), entry};
      await controls(controlsScene);
      await causalFrames(controlsScene);
      await assertFits(controlsScene, `${entry.name} desktop`);
      await controlsContext.close();
    } else {
      await controls(scene);
      await causalFrames(scene);
      await assertFits(scene, `${entry.name} desktop`);
      await context.close();
    }
  }

  for (const theme of profile === 'desktop' ? [] : ['light', 'dark']) {
    const context = await makeContext({viewport: {width: 390, height: 844}, colorScheme: theme});
    for (const entry of entries) {
      const scene = {...await open(context, entry), entry};
      await scene.page.evaluate(theme => document.dispatchEvent(new CustomEvent('astro-book:set-theme', {detail: theme})), theme);
      const before = await progress(scene);
      const moving = new Set();
      for (let at = 0; at < 26; at++) {
        const sample = await sampleActor(scene, entry.activity);
        if (sample.opacity > .05) moving.add(sample.transform);
        await scene.page.waitForTimeout(150);
      }
      assert.ok(await progress(scene) > before + .05, `${entry.name} phone ${theme}: default timeline advances`);
      assert.ok(moving.size >= 3, `${entry.name} phone ${theme}: actual visible geometry changes`);
      await seek(scene, .72);
      await assertFits(scene, `${entry.name} phone ${theme}`);
      await capture(scene, `390-${theme}`);
      await scene.page.close();
    }
    await context.close();
  }

  const reduced = await makeContext({reducedMotion: 'reduce'});
  for (const entry of profile === 'desktop' ? [] : entries) {
    const scene = {...await open(reduced, entry), entry};
    assert.equal(await scene.stage.getAttribute('data-motion'), 'reduced');
    assert.equal(await progress(scene), 1);
    assert.equal(await scene.stage.getAttribute('data-playing'), 'false');
    await stationary(scene, 'system requests reduced motion');
    if (entry.name === 'heroui') {
      await scene.root.locator('input[type="radio"][value="data-table"]').check();
      assert.equal(await progress(scene), 1);
      assert.match(await scene.stage.locator('[data-motion-output]').textContent(), /data-table/);
      let spec = JSON.parse(await scene.stage.locator('[data-motion-spec]').textContent());
      assert.equal(spec.elements['sales-view'].type, 'data-table', 'reduced-motion template switch updates the visible spec at unchanged p=1');
      await scene.root.getByRole('checkbox').check();
      assert.match(await scene.stage.locator('[data-motion-output]').textContent(), /必需字段缺失/);
      spec = JSON.parse(await scene.stage.locator('[data-motion-spec]').textContent());
      assert.equal(Object.hasOwn(spec.elements['sales-view'].props.rows[0], 'quantity'), false, 'missing-field change replaces the visible spec without a phase change');
      await scene.root.getByRole('checkbox').uncheck();
      await scene.root.locator('input[type="radio"][value="metric-grid"]').check();
      assert.match(await scene.stage.locator('[data-motion-output]').textContent(), /metric-grid.*150/);
      spec = JSON.parse(await scene.stage.locator('[data-motion-spec]').textContent());
      assert.equal(spec.elements['sales-view'].type, 'metric-grid');
      await scene.stage.scrollIntoViewIfNeeded();
    }
    const final = await sampleActor(scene, entry.activity);
    await seek(scene, .35);
    assert.notEqual((await sampleActor(scene, entry.activity)).transform, final.transform, `${entry.name}: reduced-motion user can inspect another frame`);
    await stationary(scene, 'reduced motion scrubbed frame');
    await capture(scene, 'reduced-storyboard');
    await scene.page.close();
  }
  await reduced.close();
  assert.deepEqual(errors, [], 'no runtime page errors');
  if (screenshots) await writeFile(join(screenshots, 'motion-evidence.json'), JSON.stringify({evidence, errors, hiddenTest: 'simulated visibilitychange/document.hidden in headless Chromium'}, null, 2));
  console.log('Motion verified in normal preference; reduced-motion is a separate static/storyboard check.');
} finally {
  await browser.close();
}
