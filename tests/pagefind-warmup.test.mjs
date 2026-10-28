import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {build} from 'esbuild';

const layout = readFileSync(new URL('../src/layouts/BookLayout.astro', import.meta.url), 'utf8');
const clientSource = readFileSync(new URL('../src/lib/search-client.ts', import.meta.url), 'utf8');
const warmupSource = readFileSync(new URL('../src/scripts/pagefind-warmup.ts', import.meta.url), 'utf8');
const commandLoaderSource = readFileSync(new URL('../src/lib/search-command-module.ts', import.meta.url), 'utf8');
const blogSearchSource = readFileSync(new URL('../src/scripts/blog-search.ts', import.meta.url), 'utf8');

test('homepage layout is the only place that idle-warms Pagefind and SearchCommand', () => {
  assert.match(layout, /\{page\.url === '\/' && <script>import '\.\.\/scripts\/pagefind-warmup';<\/script>\}/);
  assert.doesNotMatch(`${clientSource}\n${warmupSource}\n${commandLoaderSource}`, /pf_meta|\/pagefind\/(?:index|fragment)/);
  assert.doesNotMatch(`${warmupSource}\n${commandLoaderSource}\n${blogSearchSource}`, /\/search\/recent\.json/);
  assert.match(clientSource, /import\(\/\* @vite-ignore \*\/ pagefindModuleUrl\(\)\)/);
  assert.match(clientSource, /await module\.init\?\.\(\)/);
  assert.match(clientSource, /loadPagefind: loadPagefindModule/);
  assert.match(warmupSource, /createPagefindWarmupController\(warmHomepageSearch\)/);
  assert.match(warmupSource, /return runHomepageIdleWarmup\(warmupPagefind, loadSearchCommandModule\)/);
  assert.match(commandLoaderSource, /return import\('\.\.\/components\/search\/SearchCommand'\)/);
  assert.doesNotMatch(commandLoaderSource, /mountSearchCommand\(|searchContent\(|loadRecentUpdates\(/);
  assert.match(blogSearchSource, /loadSearchCommandModule\(\)/);
  assert.doesNotMatch(blogSearchSource, /import\('\.\.\/components\/search\/SearchCommand'\)/);
});

async function bundleModule(path) {
  const built = await build({
    entryPoints: [new URL(path, import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false,
    define: {
      'import.meta.env.BASE_URL': '"/"',
      'import.meta.env.DEV': 'false',
    },
    plugins: [{
      name: 'stub-search-command',
      setup(pluginBuild) {
        pluginBuild.onResolve({filter: /components\/search\/SearchCommand$/}, () => ({
          path: 'search-command-stub', namespace: 'search-command-stub',
        }));
        pluginBuild.onLoad({filter: /.*/, namespace: 'search-command-stub'}, () => ({
          contents: 'export function mountSearchCommand() { throw new Error("search command must not mount during warmup"); }',
          loader: 'js',
        }));
      },
    }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
}
const {createPagefindLoader} = await bundleModule('../src/lib/search-client.ts');
const {createSearchCommandLoader} = await bundleModule('../src/lib/search-command-module.ts');
const {isBlogHomepage, schedulePagefindWarmup, createPagefindWarmupController, runHomepageIdleWarmup} = await bundleModule('../src/scripts/pagefind-warmup.ts');

test('homepage detection follows the site base path', () => {
  assert.equal(isBlogHomepage('/', '/'), true);
  assert.equal(isBlogHomepage('/posts/', '/'), false);
  assert.equal(isBlogHomepage('/blog/', '/blog/'), true);
  assert.equal(isBlogHomepage('/blog/posts/', '/blog/'), false);
});

test('warmup loads Pagefind once, calls init, and can retry a failed import', async () => {
  let loads = 0;
  let inits = 0;
  const loader = createPagefindLoader(async () => {
    if (++loads === 1) throw new Error('runtime offline');
    return {init: async () => { inits++; }, search: async () => ({results: []})};
  });
  await assert.rejects(loader.warmupPagefind(), /runtime offline/);
  await loader.warmupPagefind();
  await loader.loadPagefindModule();
  assert.equal(loads, 2);
  assert.equal(inits, 1);
});

test('a failed init keeps the downloaded module for the search path', async () => {
  let loads = 0;
  const loader = createPagefindLoader(async () => {
    loads++;
    return {init: async () => { throw new Error('wasm missing'); }, search: async () => ({results: []})};
  });
  await assert.rejects(loader.warmupPagefind(), /wasm missing/);
  const module = await loader.loadPagefindModule();
  assert.equal(typeof module.search, 'function');
  assert.equal(loads, 1);
});

test('idle warmup uses requestIdleCallback and falls back to a short timeout', async () => {
  const idle = [];
  let warmed = 0;
  schedulePagefindWarmup(async () => { warmed++; }, {
    requestIdleCallback: (callback, options) => { idle.push(options); callback(); return 1; },
    setTimeout: () => { throw new Error('setTimeout should not run when idle callbacks exist'); },
  });
  assert.deepEqual(idle, [{timeout: 2000}]);
  await Promise.resolve();
  assert.equal(warmed, 1);

  const timers = [];
  let fallback = 0;
  schedulePagefindWarmup(async () => { fallback++; }, {
    setTimeout: (callback, delay) => { timers.push(delay); callback(); return 1; },
  });
  assert.deepEqual(timers, [200]);
  await Promise.resolve();
  assert.equal(fallback, 1);
});

test('command loader imports once, retries a failed download, and does not mount', async () => {
  let loads = 0;
  let mounts = 0;
  const load = createSearchCommandLoader(async () => {
    if (++loads === 1) throw new Error('chunk offline');
    return {mountSearchCommand() { mounts++; }};
  });
  await assert.rejects(load(), /chunk offline/);
  const module = await load();
  await load();
  assert.equal(loads, 2);
  assert.equal(mounts, 0);
  assert.equal(typeof module.mountSearchCommand, 'function');

  let syncLoads = 0;
  const syncLoad = createSearchCommandLoader(() => {
    syncLoads++;
    throw new Error('chunk sync');
  });
  await assert.rejects(syncLoad(), /chunk sync/);
  await assert.rejects(syncLoad(), /chunk sync/);
  assert.equal(syncLoads, 2);
});

test('one idle warmup starts Pagefind and SearchCommand together and isolates failures', async () => {
  const order = [];
  let releasePagefind;
  const pagefind = new Promise((resolve) => { releasePagefind = resolve; });
  const pending = runHomepageIdleWarmup(
    () => { order.push('pagefind'); return pagefind; },
    async () => { order.push('command'); },
  );
  assert.deepEqual(order, ['pagefind', 'command']);
  releasePagefind();
  await pending;

  let commandRan = false;
  await runHomepageIdleWarmup(
    async () => { throw new Error('pagefind down'); },
    async () => { commandRan = true; },
  );
  assert.equal(commandRan, true);

  await runHomepageIdleWarmup(
    () => { throw new Error('pagefind sync'); },
    async () => { commandRan = 'after-sync'; },
  );
  assert.equal(commandRan, 'after-sync');

  await runHomepageIdleWarmup(async () => {}, async () => { throw new Error('chunk down'); });
});

test('warmup errors stay on the idle path and only the homepage arms it', async () => {
  const calls = [];
  const controller = createPagefindWarmupController(async () => { throw new Error('preload failed'); });
  const host = {
    location: {pathname: '/posts/'},
    requestIdleCallback: (callback) => { calls.push(callback); return 1; },
    setTimeout: () => { throw new Error('unexpected timeout'); },
  };
  assert.equal(controller.arm(host, '/'), false);
  assert.equal(calls.length, 0);
  host.location.pathname = '/';
  assert.equal(controller.arm(host, '/'), true);
  assert.equal(controller.arm(host, '/'), false);
  assert.equal(calls.length, 1);
  calls[0]();
  await Promise.resolve();
  await Promise.resolve();
});
