import {loadSearchCommandModule} from '../lib/search-command-module';
import {warmupPagefind} from '../lib/search-client';

export function isBlogHomepage(pathname: string, base: string) {
  const root = base.replace(/\/$/, '');
  const path = pathname.replace(/\/$/, '');
  return path === root;
}

interface PagefindIdleHost {
  location: {pathname: string};
  requestIdleCallback?: (callback: () => void, options?: {timeout?: number}) => number;
  setTimeout: (callback: () => void, delay?: number) => number;
}

/** Run one homepage idle task. Browsers without idle callbacks wait one short task. */
export function schedulePagefindWarmup(warm: () => Promise<unknown>, host: Pick<PagefindIdleHost, 'requestIdleCallback' | 'setTimeout'>) {
  const run = () => { void Promise.resolve(warm()).catch(() => {}); };
  if (typeof host.requestIdleCallback === 'function') {
    host.requestIdleCallback(run, {timeout: 2000});
    return;
  }
  host.setTimeout(run, 200);
}

export function createPagefindWarmupController(warm: () => Promise<unknown>) {
  let started = false;
  return {
    arm(host: PagefindIdleHost, base: string) {
      if (started || !isBlogHomepage(host.location.pathname, base)) return false;
      started = true;
      schedulePagefindWarmup(warm, host);
      return true;
    },
  };
}

/**
 * One homepage idle callback starts Pagefind init and the SearchCommand import together.
 * The import only evaluates that module. It does not mount the dialog or run a query.
 * Either failure is ignored so the other warmup can still finish.
 */
export function runHomepageIdleWarmup(
  warmPagefind: () => Promise<unknown>,
  prefetchCommand: () => Promise<unknown>,
) {
  const tasks = [warmPagefind, prefetchCommand].map((start) => {
    try {
      return Promise.resolve(start()).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  });
  return Promise.all(tasks);
}

export function warmHomepageSearch() {
  return runHomepageIdleWarmup(warmupPagefind, loadSearchCommandModule);
}

const homepageWarmup = createPagefindWarmupController(warmHomepageSearch);

function armHomepagePagefind() {
  homepageWarmup.arm(window, import.meta.env.BASE_URL || '/');
}

if (typeof window !== 'undefined') {
  armHomepagePagefind();
  document.addEventListener('astro:page-load', armHomepagePagefind);
}
