import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const legacy = JSON.parse(await readFile(new URL('../scripts/legacy-routes.json', import.meta.url), 'utf8'));
const bySource = new Map(legacy.pages.filter(page => page.source).map(page => [page.source, page]));

test('系统集成 section is merged into Linux', () => {
  assert.ok(!legacy.pages.some(page => page.source.startsWith('docs/软件工程/系统集成/')));
  const webhook = bySource.get('docs/Linux/网络/WebHook URL.md');
  assert.equal(webhook.url, '/docs/Linux/%E7%BD%91%E7%BB%9C/WebHook-URL/');
  assert.equal(webhook.parent, '/docs/Linux/%E7%BD%91%E7%BB%9C/');
});
