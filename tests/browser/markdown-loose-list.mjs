import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import tailwind from '@tailwindcss/vite';

const server = await createServer({
  configFile: false,
  root: new URL('../..', import.meta.url).pathname,
  plugins: [tailwind()],
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: {
    entries: ['tests/fixtures/markdown-loose-list.html'],
  },
});
await server.listen();
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? `http://127.0.0.1:${server.config.server.port}`;

function measureListItems(page) {
  return page.evaluate(() => {
    const textTop = (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(true);
      return range.getClientRects()[0]?.top ?? node.getBoundingClientRect().top;
    };
    const items = [...document.querySelectorAll('[data-loose-list-fixture] li')];
    return items.map((li) => {
      const paragraphs = [...li.querySelectorAll(':scope > p')];
      const liTop = li.getBoundingClientRect().top;
      const fontSize = parseFloat(getComputedStyle(li).fontSize) || 16;
      return {
        offsetsEm: paragraphs.map((p) => (textTop(p) - liTop) / fontSize),
        firstMarginTopEm: paragraphs[0] ? parseFloat(getComputedStyle(paragraphs[0]).marginTop) / fontSize : 0,
        followMarginTopEm: paragraphs[1] ? parseFloat(getComputedStyle(paragraphs[1]).marginTop) / fontSize : null,
      };
    });
  });
}

const browser = await chromium.launch({ headless: true });
try {
  for (const theme of [
    { name: 'light', apply: async (page) => { await page.evaluate(() => { document.documentElement.classList.remove('dark'); document.documentElement.dataset.bookTheme = 'light'; }); } },
    { name: 'dark', apply: async (page) => { await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.dataset.bookTheme = 'dark'; }); } },
  ]) {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(10000);
      await page.goto(`${base}/tests/fixtures/markdown-loose-list.html`);
      await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
      await theme.apply(page);
      const items = await measureListItems(page);
      assert.equal(items.length, 3, `${theme.name} ${viewport.width}px: fixture list length`);
      for (const [index, item] of items.entries()) {
        assert.ok(item.offsetsEm[0] < 0.5, `${theme.name} ${viewport.width}px: item ${index + 1} text aligns with marker (${item.offsetsEm[0]}em)`);
        assert.ok(item.firstMarginTopEm < 0.05, `${theme.name} ${viewport.width}px: item ${index + 1} first paragraph has no top margin`);
      }
      assert.ok((items[2].followMarginTopEm ?? 0) > 0.5, `${theme.name} ${viewport.width}px: following paragraphs keep spacing`);
      await page.close();
    }
  }
  console.log('Loose list marker alignment passed for light/dark and desktop/mobile viewports.');
} finally {
  await browser.close();
  await server.close();
}
