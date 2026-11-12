/** Errors the site cannot fix: third-party scripts, flaky networks, corrupted deliveries. */

const SITE_HOST = 'yindongliang.com';
const AD_HOST = /(?:^|\.)(?:googlesyndication\.com|doubleclick\.net|googleadservices\.com|googletagservices\.com|adtrafficquality\.google)$/i;
const GSI_HOST = /(?:^|\.)accounts\.google\.com$/i;
const NETWORK_FAILURE = /^(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)(?: \(.+\))?$/;
// Sentry's minified `wrap` listener. A readable site handler such as `onreadystatechange` stays put.
const SENTRY_XHR_LISTENER = /^XMLHttpRequest\.[A-Za-z_$][A-Za-z0-9_$]{0,2}$/;

/**
 * @param {{
 *   exception?: {values?: Array<{type?: string, value?: string, mechanism?: {type?: string, handled?: boolean},
 *     stacktrace?: {frames?: Array<{filename?: string, abs_path?: string, function?: string, lineno?: number, colno?: number}>}}>},
 *   tags?: Record<string, unknown>,
 * }} event
 */
export function isThirdPartyNoise(event) {
  const values = event.exception?.values;
  const exception = values?.[values.length - 1];
  if (!exception) return false;
  const frames = exception.stacktrace?.frames ?? [];
  const thrownAt = frames[frames.length - 1];
  const source = frameSource(thrownAt);

  // Google Ads scripts injected by extensions or ad slots, e.g. `Error: int64` in rum_fy2021.js.
  if (isAdScript(source)) return true;

  // Google Identity Services (`/gsi/client`). A path-only frame resolves to this
  // site, and Sentry's XHR Proxy can occupy the last frames of the page chunk.
  if (isGsiClient(source) || isGsiClient(sourceUnderSentryXhrWrappers(frames))) return true;

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

/** @param {{abs_path?: string, filename?: string} | undefined} frame */
function frameSource(frame) {
  return frame?.abs_path ?? frame?.filename;
}

/**
 * Trailing `Object.apply` + `XMLHttpRequest.<minified>` frames are Sentry's
 * XHR proxy and wrapped listener inside `/_astro/page.*.js`, not the script that threw.
 * @param {Array<{filename?: string, abs_path?: string, function?: string}>} frames
 */
function sourceUnderSentryXhrWrappers(frames) {
  let index = frames.length - 1;
  let sawProxy = false;
  let sawListener = false;
  while (index >= 0 && isSentryXhrWrapper(frames[index])) {
    if (frames[index].function === 'Object.apply') sawProxy = true;
    else sawListener = true;
    index -= 1;
  }
  if (!sawProxy || !sawListener) return undefined;
  return frameSource(frames[index]);
}

/** @param {{filename?: string, abs_path?: string, function?: string} | undefined} frame */
function isSentryXhrWrapper(frame) {
  const name = frame?.function;
  if (name !== 'Object.apply' && (typeof name !== 'string' || !SENTRY_XHR_LISTENER.test(name))) return false;
  return isSitePageChunk(frameSource(frame));
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
function isGsiClient(filename) {
  if (!filename) return false;
  // Path-only `/gsi/client` resolves to this site and would fail a hostname check.
  if (!filename.includes('://') && !filename.startsWith('//') && filename.split(/[?#]/, 1)[0] === '/gsi/client') {
    return true;
  }
  const url = scriptURL(filename);
  return Boolean(url && GSI_HOST.test(url.hostname) && url.pathname === '/gsi/client');
}

/** @param {string | undefined} filename */
function isSiteChunk(filename) {
  const url = scriptURL(filename);
  return Boolean(url && url.hostname === SITE_HOST && url.pathname.startsWith('/_astro/') && url.pathname.endsWith('.js'));
}

/** @param {string | undefined} filename */
function isSitePageChunk(filename) {
  const url = scriptURL(filename);
  return Boolean(url && url.hostname === SITE_HOST && /^\/_astro\/page(?:\.[A-Za-z0-9_-]+)?\.js$/.test(url.pathname));
}
