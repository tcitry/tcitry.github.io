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

/** Start Pagefind init while the browser is idle. Browsers without idle callbacks wait one short task. */
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

const homepageWarmup = createPagefindWarmupController(warmupPagefind);

function armHomepagePagefind() {
  homepageWarmup.arm(window, import.meta.env.BASE_URL || '/');
}

if (typeof window !== 'undefined') {
  armHomepagePagefind();
  document.addEventListener('astro:page-load', armHomepagePagefind);
}
