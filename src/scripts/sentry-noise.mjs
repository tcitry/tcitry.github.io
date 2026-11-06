/** Errors the site cannot fix: third-party scripts, flaky networks, corrupted deliveries. */

const SITE_HOST = 'yindongliang.com';
const AD_HOST = /(?:^|\.)(?:googlesyndication\.com|doubleclick\.net|googleadservices\.com|googletagservices\.com|adtrafficquality\.google)$/i;
const NETWORK_FAILURE = /^(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)(?: \(.+\))?$/;

/**
 * @param {{
 *   exception?: {values?: Array<{type?: string, value?: string, mechanism?: {type?: string, handled?: boolean},
 *     stacktrace?: {frames?: Array<{filename?: string, abs_path?: string, lineno?: number, colno?: number}>}}>},
 *   tags?: Record<string, unknown>,
 * }} event
 */
export function isThirdPartyNoise(event) {
  const values = event.exception?.values;
  const exception = values?.[values.length - 1];
  if (!exception) return false;
  const frames = exception.stacktrace?.frames ?? [];
  const thrownAt = frames[frames.length - 1];
  const source = thrownAt?.abs_path ?? thrownAt?.filename;

  // Google Ads scripts injected by extensions or ad slots, e.g. `Error: int64` in rum_fy2021.js.
  if (isAdScript(source)) return true;

  // The search panel already shows a retry when its recent-updates request drops.
  if (event.tags?.feature === 'search' && event.tags?.operation === 'recent_load'
    && exception.type === 'TypeError' && NETWORK_FAILURE.test(exception.value ?? '')) return true;

  // A valid hashed chunk that fails at its first bytes was altered in transit
  // (proxy, extension, broken cache). A real build error fails on every client.
  return exception.type === 'SyntaxError'
    && exception.value === 'Invalid or unexpected token'
    && exception.mechanism?.type === 'auto.browser.global_handlers.onerror'
    && frames.length === 1
    && thrownAt?.lineno === 1 && (thrownAt.colno ?? 0) <= 2
    && isSiteChunk(source);
}

/** @param {string | undefined} filename */
function scriptURL(filename) {
  if (!filename) return null;
  try {
    return new URL(filename, `https://${SITE_HOST}`);
  } catch {
    return null;
  }
}

/** @param {string | undefined} filename */
function isAdScript(filename) {
  const url = scriptURL(filename);
  return Boolean(url && AD_HOST.test(url.hostname));
}

/** @param {string | undefined} filename */
function isSiteChunk(filename) {
  const url = scriptURL(filename);
  return Boolean(url && url.hostname === SITE_HOST && url.pathname.startsWith('/_astro/') && url.pathname.endsWith('.js'));
}
