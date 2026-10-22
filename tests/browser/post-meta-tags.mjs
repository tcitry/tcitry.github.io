import assert from 'node:assert/strict';
import { mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import tailwind from '@tailwindcss/vite';

const visitedTag = '/tags/Cloudflare/';
const freshTag = '/tags/GitHub/';
const visitedProse = '/docs/visited-prose/';
const freshProse = '/docs/fresh-prose/';
function artifactDir() {
  if (process.env.BLOG_SCREENSHOT_DIR) return process.env.BLOG_SCREENSHOT_DIR;
  try {
    statSync('/opt/cursor/artifacts');
    return '/opt/cursor/artifacts';
  } catch {
    return tmpdir();
  }
}

const server = await createServer({
  configFile: false,
  root: new URL('../..', import.meta.url).pathname,
  plugins: [tailwind()],
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { entries: ['tests/fixtures/post-meta-tags.html'] },
});
await server.listen();
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? `http://127.0.0.1:${server.config.server.port}`;

function rgb(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Expected a hex color, received ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const screenshots = artifactDir();
  mkdirSync(screenshots, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(15000);
  const query = new URLSearchParams({ visitedTag, freshTag, visitedProse, freshProse });
  await page.goto(`${base}/tests/fixtures/post-meta-tags.html?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  const session = await page.context().newCDPSession(page);
  await session.send('DOM.enable');
  await session.send('CSS.enable');

  async function queryAll(selectors) {
    const { root } = await session.send('DOM.getDocument');
    const found = {};
    for (const [name, selector] of Object.entries(selectors)) {
      const { nodeIds: ids } = await session.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
      assert.ok(ids.length > 0, `Missing ${selector}`);
      found[name] = ids;
    }
    return found;
  }

  async function computedColor(nodeId) {
    const { computedStyle } = await session.send('CSS.getComputedStyleForNode', { nodeId });
    return computedStyle.find((property) => property.name === 'color')?.value;
  }

  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((name) => {
      document.documentElement.dataset.bookTheme = name;
      document.documentElement.classList.toggle('dark', name === 'dark');
    }, theme);
    const tokens = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return {
        link: styles.getPropertyValue('--color-link'),
        visited: styles.getPropertyValue('--color-visited-link'),
      };
    });
    const link = rgb(tokens.link);
    const visited = rgb(tokens.visited);
    assert.notEqual(link, visited, `${theme}: theme link and visited colors differ`);

    const { tagVisited, tagFresh, proseVisited, proseFresh } = await queryAll({
      tagVisited: '[data-visual-tag="visited"]',
      tagFresh: '[data-visual-tag="fresh"]',
      proseVisited: '[data-prose="visited"]',
      proseFresh: '[data-prose="fresh"]',
    });
    for (const nodeId of [...tagVisited, ...proseVisited]) {
      await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['visited'] });
    }

    for (const nodeId of [...tagVisited, ...tagFresh]) {
      assert.equal(await computedColor(nodeId), link, `${theme}: tag links stay on the theme link color when visited`);
    }
    assert.equal(await computedColor(proseVisited[0]), visited, `${theme}: article prose still uses the visited color`);
    assert.equal(await computedColor(proseFresh[0]), link, `${theme}: unvisited prose uses the theme link color`);
    await page.locator('[data-tag-fixture]').screenshot({ path: `${screenshots}/post-meta-tags-${theme}.png` });
  }
  console.log('Post meta tag links use the theme link color for visited and unvisited states.');
} finally {
  await browser?.close();
  await server.close();
}
