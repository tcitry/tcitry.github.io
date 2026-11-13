import assert from 'node:assert/strict';
import { assetPathname } from '../src/lib/public-url.mjs';

export const STATIC_REDIRECT_LIMIT = 2000;

// Lowercase literal characters only. Escaped bytes (including UTF-8 and %2B)
// retain their canonical spelling and are never decoded a second time.
export function lowercaseRoute(url) {
  return assetPathname(url).replace(/%[\da-f]{2}|[^%]+/gi, part => part.startsWith('%') ? part : part.toLowerCase());
}

export function generateRouteRedirects(routes, aliases, migrations = [], retirements = {}) {
  const canonical = new Set(routes.map(route => assetPathname(route.url)));
  const staticRules = [];
  const targets = new Map();
  const preservedAliases = [];
  const skippedCanonical = [];
  const variants = url => url.endsWith('/') && url !== '/' ? [url, url.slice(0, -1)] : [url];
  const shadowsCanonical = from => canonical.has(from) || canonical.has(`${from}/`);

  for (const [alias, url] of aliases) {
    const from = assetPathname(alias), to = assetPathname(url);
    if (shadowsCanonical(from)) continue;
    assert.ok(canonical.has(to), `Alias has no canonical destination: ${alias} -> ${url}`);
    assert.ok(!targets.has(from) || targets.get(from) === to, `Conflicting aliases: ${alias}`);
    if (targets.has(from)) continue;
    staticRules.push({ from: alias, to: url, status: 301 });
    for (const source of variants(from)) {
      assert.ok(!targets.has(source) || targets.get(source) === to, `Conflicting alias variants: ${source}`);
      targets.set(source, to);
    }
  }
  assert.ok(staticRules.length <= STATIC_REDIRECT_LIMIT, `Cloudflare static redirect limit exceeded: ${staticRules.length}/${STATIC_REDIRECT_LIMIT}`);
  for (const rule of staticRules) assert.ok(`${rule.from} ${rule.to} 301`.length <= 1000, `Cloudflare redirect line too long: ${rule.from}`);

  const aliasSources = new Set(targets.keys());
  function add(from, to) {
    if (shadowsCanonical(from)) {
      skippedCanonical.push({ from, to });
      return;
    }
    for (const source of variants(from)) {
      if (aliasSources.has(source) && targets.get(source) !== to) {
        // Explicit content migrations take precedence over automatic casing.
        preservedAliases.push({ from: source, to: targets.get(source), automaticDestination: to });
        continue;
      }
      assert.ok(!targets.has(source) || targets.get(source) === to, `Ambiguous lowercase redirect: ${source}`);
      targets.set(source, to);
    }
  }

  for (const [from, to] of migrations) {
    assert.ok(canonical.has(to), `Migration has no canonical destination: ${from}`);
    const source = from === '/' ? from : from.replace(/\/$/, '') + '/';
    add(source, to);
    for (const variant of variants(source)) aliasSources.add(variant);
  }
  for (const url of canonical) {
    const from = lowercaseRoute(url);
    if (from !== url) add(from, url);
    if (url.startsWith('/docs/Apple/')) add(url.replace('/docs/Apple/', '/docs/Xcode/'), url);
  }
  for (const from of Object.keys(retirements)) assert.ok(!targets.has(from), `Retired URL would redirect: ${from}`);
  return { staticRules, workerRules: Object.fromEntries([...targets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), preservedAliases, skippedCanonical };
}
