import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH});
const base = process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321';
const close = (a, b, label) => assert.ok(Math.abs(a - b) < 2, `${label}: ${a} vs ${b}`);

try {
  for (const width of [1440, 480, 360]) {
    const page = await browser.newPage({viewport: {width, height: 1000}, reducedMotion: 'no-preference'});
    await page.goto(new URL('/docs/AI/Agents/deepseek-harness-plugin-architecture/', base).href);
    const root = page.locator('[data-demo="deepseek-plugins"]');
    const player = root.locator('[data-mechanism-player]');
    await player.scrollIntoViewIfNeeded();
    await root.locator('[data-hydrated="true"]').waitFor();
    const scenarios = root.locator('[aria-label="对照条件"] button');
    const boxes = await scenarios.evaluateAll(nodes => nodes.map(node => {
      const {x, y, width, height} = node.getBoundingClientRect();
      return {x, y, width, height};
    }));
    for (const box of boxes) {
      close(box.width, boxes[0].width, 'equal scenario width');
      close(box.height, boxes[0].height, 'equal scenario height');
    }
    if (width === 1440) {
      for (const box of boxes) close(box.y, boxes[0].y, 'scenario row');
      close(boxes[1].x - boxes[0].x - boxes[0].width, boxes[2].x - boxes[1].x - boxes[1].width, 'scenario gaps');
    }
    const layout = await player.locator('[aria-label$="的动画控制"]').evaluate(node => {
      const rect = element => {
        const {x, y, width, height} = element.getBoundingClientRect();
        return {x, y, width, height, center: y + height / 2};
      };
      return {box: rect(node), children: [...node.children].map(rect), gap: parseFloat(getComputedStyle(node).gap)};
    });
    const [toggle, restart, speed, scrub, position] = layout.children;
    close(toggle.center, restart.center, 'transport alignment');
    close(toggle.center, speed.center, 'speed alignment');
    close(scrub.center, position.center, 'progress alignment');
    if (width === 1440) close(toggle.center, scrub.center, 'desktop single row');
    else assert.ok(scrub.y >= toggle.y + toggle.height, 'narrow progress moves to its own row');
    assert.ok(layout.gap >= 12, 'consistent control gap');
    close(position.x + position.width, layout.box.x + layout.box.width - 16, 'right aligned percentage');
    for (const box of layout.children) {
      assert.ok(box.x >= layout.box.x + 15 && box.x + box.width <= layout.box.x + layout.box.width - 15, 'controls retain inset');
    }
    assert.ok(await root.evaluate(node => node.scrollWidth <= node.clientWidth), 'no horizontal figure overflow');

    for (const [index, expected] of ['ACTIVE', 'ACTIVE', 'DISPOSED'].entries()) {
      await scenarios.nth(index).click();
      assert.equal(await scenarios.nth(index).getAttribute('aria-pressed'), 'true');
      const range = player.locator('[data-motion-seek]');
      await range.focus();
      await page.keyboard.press('End');
      await page.waitForFunction(() => document.querySelector('[data-demo="deepseek-plugins"] [data-mechanism-stage]').dataset.progress === '1.0000');
      assert.equal(await root.locator('[data-readout="state"]').textContent(), expected);
    }
    await player.locator('[data-motion-restart]').click();
    const stage = player.locator('[data-mechanism-stage]');
    assert.ok(Number(await stage.getAttribute('data-progress')) < .1, 'replay resets progress');
    await player.locator('[data-motion-toggle]').click();
    assert.equal(await stage.getAttribute('data-playing'), 'false', 'pause');
    await player.locator('select').selectOption('0.5');
    await player.locator('[data-motion-toggle]').click();
    await page.waitForFunction(() => document.querySelector('[data-demo="deepseek-plugins"] [data-mechanism-stage]').dataset.playing === 'true');
    const range = player.locator('[data-motion-seek]');
    const track = await range.boundingBox();
    await page.mouse.move(track.x + track.width * .5, track.y + track.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * .7, track.y + track.height / 2, {steps: 8});
    await page.mouse.up();
    assert.ok(Number(await stage.getAttribute('data-progress')) > .6, 'pointer scrubbing');
    assert.equal(await stage.getAttribute('data-playing'), 'false', 'scrubbing pauses');
    console.log(`PASS DeepSeek controls: ${width}px layout and interactions`);
    await page.close();
  }
} finally {
  await browser.close();
}
