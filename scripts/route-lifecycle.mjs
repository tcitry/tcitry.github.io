import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assetPathname, siteOrigin } from '../src/lib/public-url.mjs';

function publicPath(value) {
  assert.ok(typeof value === 'string' && value.startsWith('/') && !value.startsWith('//'), `Invalid public pathname: ${value}`);
  const url = new URL(value, siteOrigin);
  assert.ok(url.origin === siteOrigin && !url.search && !url.hash && !value.includes('\\'), `Invalid public pathname: ${value}`);
  assert.equal(value, assetPathname(value), `Use the encoded public pathname: ${value}`);
  assert.ok(value !== '/api' && !value.startsWith('/api/'), 'Worker API paths are not public page migrations');
  return value;
}

export function validateHistory(history) {
  assert.equal(history?.version, 1, 'Unsupported public route history');
  assert.ok(Array.isArray(history.paths) && history.paths.length > 0, 'Public route history must not be empty');
  history.paths.forEach(publicPath);
  assert.equal(new Set(history.paths).size, history.paths.length, 'Duplicate public route history');
  return history;
}

// No private source names, titles or content revisions enter this public artifact.
export function routeLifecycle(routes, aliases, policy, baseline) {
  validateHistory(baseline);
  assert.equal(policy.version, 1, 'Unsupported route migration policy');
  const canonical = new Set(routes.map(route => assetPathname(route.url)));
  const edges = new Map();
  const key = value => value === '/' ? '/' : value.replace(/\/$/, '');
  const canonicalKeys = new Set([...canonical].map(key));
  function edge(from, to) {
    from = assetPathname(from); to = assetPathname(to);
    assert.ok(!edges.has(key(from)) || edges.get(key(from)) === to, `Conflicting URL migration: ${from}`);
    edges.set(key(from), to);
  }
  for (const [from, to] of aliases) edge(from, to);
  for (const [from, record] of Object.entries(policy.redirects)) {
    publicPath(from); publicPath(record.to);
    assert.ok(record.reason?.trim(), `URL migration needs a reason: ${from}`);
    assert.ok(!canonicalKeys.has(key(from)), `URL migration shadows a canonical route: ${from}`);
    edge(from, record.to);
  }
  function resolve(from) {
    const seen = new Set();
    let to = from;
    while (!canonical.has(to)) {
      assert.ok(!seen.has(key(to)), `URL migration cycle: ${from}`);
      seen.add(key(to));
      assert.ok(edges.has(key(to)), `URL migration has no canonical destination: ${from} -> ${to}`);
      to = edges.get(key(to));
    }
    return to;
  }
  const retired = {};
  for (const [from, record] of Object.entries(policy.retired)) {
    publicPath(from);
    assert.ok(record.reason?.trim() && [404, 410].includes(record.status), `Retired URL needs a reason and 404/410 status: ${from}`);
    assert.ok(!canonicalKeys.has(key(from)) && !edges.has(key(from)), `Retired URL is still published or redirected: ${from}`);
    for (const source of from === '/' ? ['/'] : [key(from), `${key(from)}/`]) {
      assert.ok(!Object.hasOwn(retired, source) || retired[source] === record.status, `Conflicting retirement statuses: ${from}`);
      retired[source] = record.status;
    }
  }
  const migrations = Object.keys(policy.redirects).map(from => [from, resolve(from)]);
  const resolvedAliases = aliases.map(([from, to]) => [from, resolve(to)]);
  const known = new Set([...canonical, ...aliases.map(([from]) => assetPathname(from)), ...Object.keys(policy.redirects), ...Object.keys(policy.retired)]);
  const protectedKeys = new Set([...known].map(key));
  const missing = baseline.paths.filter(url => !protectedKeys.has(key(url)));
  assert.deepEqual(missing, [], 'Previously published URLs disappeared; preserve the canonical URL, add an explicit migration, or declare retirement in scripts/route-migrations.json');
  return { aliases: resolvedAliases, migrations, retired,
    history: { version: 1, paths: [...new Set([...baseline.paths, ...known])].sort() } };
}

// Production always compares with the last published release. Only the first
// rollout may bootstrap from its sitemap. Once the marker advertises history,
// a missing/malformed manifest is a hard failure, never a silent re-baseline.
export async function publishedRouteHistory(fetcher = fetch) {
  async function request(file, optional = false) {
    const response = await fetcher(`${siteOrigin}/${file}?route-history=${Date.now()}`, {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (optional && response.status === 404) return null;
    assert.equal(response.status, 200, `Cannot read published ${file}`);
    const body = await response.text();
    assert.ok(body.length <= 2 * 1024 * 1024, 'Published route metadata is too large');
    return body;
  }
  const marker = JSON.parse(await request('blog-release.json'));
  assert.equal(marker.version, 1, 'Unsupported published release marker');
  assert.ok(marker.routeHistoryVersion === undefined || marker.routeHistoryVersion === 1, 'Unsupported published history marker');
  const body = await request('route-history.json', true);
  let history;
  if (body !== null) history = validateHistory(JSON.parse(body));
  else {
    assert.ok(!marker.routeHistoryVersion, 'Published route history is missing; refusing to reset history');
    const xml = await request('sitemap.xml');
    const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => {
      const url = new URL(loc.trim().replaceAll('&amp;', '&'));
      assert.equal(url.origin, siteOrigin, 'Published sitemap has an off-site URL');
      assert.ok(!url.search && !url.hash, 'Published sitemap has a noncanonical URL');
      return url.pathname;
    });
    history = validateHistory({ version: 1, paths });
  }
  const after = JSON.parse(await request('blog-release.json'));
  assert.ok(JSON.stringify(after) === JSON.stringify(marker), 'Published release changed while reading route history; retry the build');
  return history;
}

export async function routeBaseline(root, environment) {
  if (environment === 'production') return { source: 'published', history: await publishedRouteHistory() };
  try {
    return { source: 'local-preview', history: validateHistory(JSON.parse(await readFile(path.join(root, 'dist/route-history.json'), 'utf8'))) };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const legacy = JSON.parse(await readFile(path.join(root, 'scripts/legacy-routes.json'), 'utf8'));
  return { source: 'legacy-bootstrap', history: validateHistory({ version: 1, paths: [...new Set(legacy.pages.map(page => assetPathname(page.url)))].sort() }) };
}

// Recheck immediately before deployment too: a content-only release may have
// introduced URLs since this artifact was sealed, even on the same site commit.
export async function assertPublishedHistoryRetained(root, assets, fetcher = fetch) {
  if (!Object.hasOwn(assets, 'route-history.json')) return; // Legacy/static fixtures.
  const local = validateHistory(JSON.parse(await readFile(path.join(root, 'dist/route-history.json'), 'utf8')));
  const published = await publishedRouteHistory(fetcher);
  const paths = new Set(local.paths);
  assert.ok(published.paths.every(url => paths.has(url)), 'New URLs were published after this build; rebuild before deploying to preserve their history');
}
