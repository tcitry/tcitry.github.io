/** Vite rejects the whole dynamic import if a CSS preload link errors. */

export const CHAT_LOAD_RETRY_DELAY_MS = 400;
export const STALE_CHAT_ASSET_RELOAD_KEY = 'blog-chat-stale-asset-reload';

export const CLERK_QUIET_FAILURE_CODES = ['failed_to_load_clerk_js', 'failed_to_load_clerk_ui'];
export const CLERK_QUIET_FAILURE_PATTERNS = [
  /\bClerk: Failed to load Clerk (?:JS|UI)\b/i,
  /\bClerkJS: Network error at ["']https:\/\/[^/\s"']+\/v1\/[^\s"']*["']/i,
];

/** @param {unknown} value */
export function isClerkLoadErrorMessage(value) {
  return typeof value === 'string' && (
    CLERK_QUIET_FAILURE_CODES.some((code) => value.includes(`code="${code}"`))
    || CLERK_QUIET_FAILURE_PATTERNS.some((pattern) => pattern.test(value))
  );
}

/** @param {unknown} error */
export function isQuietClerkError(error) {
  const seen = new Set();
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error);
    if (('code' in error && CLERK_QUIET_FAILURE_CODES.includes(String(error.code)))
      || ('message' in error && isClerkLoadErrorMessage(error.message))) return true;
    error = 'cause' in error ? error.cause : undefined;
  }
  return false;
}

/** @param {{exception?: {values?: Array<{value?: string}>}}} event */
export function isQuietClerkEvent(event) {
  return event.exception?.values?.some((exception) => isClerkLoadErrorMessage(exception.value)) ?? false;
}

/** @param {EventTarget} [target] */
export function quietClerkRejections(target = globalThis) {
  /** @param {Event} event */
  function onRejection(event) {
    if ('reason' in event && isQuietClerkError(event.reason)) event.preventDefault();
  }
  target.addEventListener('unhandledrejection', onRejection);
  return () => target.removeEventListener('unhandledrejection', onRejection);
}

/**
 * @param {unknown} value
 */
export function isAssetLoadErrorMessage(value) {
  return typeof value === 'string' && (
    /Unable to preload CSS/i.test(value)
    || /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(value)
  );
}

/**
 * @param {unknown} error
 */
export function isCssPreloadError(error) {
  return error instanceof Error && /Unable to preload CSS/i.test(error.message);
}

/**
 * @param {unknown} error
 */
export function isAssetLoadError(error) {
  return error instanceof Error && isAssetLoadErrorMessage(error.message);
}

/**
 * @param {unknown} error
 */
export function isClerkLoadError(error) {
  if (isQuietClerkError(error)) return true;
  if (!(error instanceof Error)) return false;
  return error.message.includes('Clerk:') || ('clerkError' in error && error.clerkError === true);
}

/**
 * Clerk races and mount races can succeed on a second import. A missing hashed
 * chunk cannot; `reloadForStaleChatAsset` handles that instead of retrying.
 * @param {unknown} error
 */
export function isRetriableChatLoadError(error) {
  if (isAssetLoadError(error)) return false;
  if (isClerkLoadError(error)) return true;
  if (error instanceof TypeError) return true;
  return error instanceof Error && /ChunkLoadError/i.test(error.name);
}

/**
 * @param {unknown} error
 * @param {'import' | 'mount'} [phase]
 */
export function chatLoadFailureCopy(error, phase = 'import') {
  if (isClerkLoadError(error)) return '登录服务暂时无法连接，请稍后重试。';
  if (needsChatPageRefresh(error, phase)) return '助手未能加载。若页面刚更新，请刷新后再试。';
  if (phase === 'mount' || error instanceof TypeError) return '助手未能打开，请重试。';
  return '助手未能加载，请检查网络后重试。';
}

/**
 * Safari often reports a missing hashed chunk as `TypeError: Load failed`
 * instead of Chrome's "Failed to fetch dynamically imported module".
 * A retry of the same specifier will not refetch; the page HTML must reload.
 * @param {unknown} error
 * @param {'import' | 'mount'} [phase]
 */
export function needsChatPageRefresh(error, phase = 'import') {
  if (isAssetLoadError(error)) return true;
  return phase === 'import' && error instanceof TypeError;
}

/**
 * Stale hashed chunks after a deploy are recovered in the UI. Reporting them
 * to Sentry duplicates the refresh guidance on every open tab.
 * @param {unknown} error
 * @param {'import' | 'mount'} [phase]
 */
export function shouldReportChatLoadError(error, phase = 'import') {
  return !isQuietClerkError(error) && !needsChatPageRefresh(error, phase);
}

/**
 * A missing hashed import cannot be retried; reload once to pick up new HTML.
 * @param {Pick<Storage, 'getItem' | 'setItem'>} [storage]
 * @param {() => void} [reload]
 */
export function reloadForStaleChatAsset(storage, reload) {
  try {
    storage ??= globalThis.sessionStorage;
    if (storage.getItem(STALE_CHAT_ASSET_RELOAD_KEY) === '1') return false;
    storage.setItem(STALE_CHAT_ASSET_RELOAD_KEY, '1');
  } catch {
    return false;
  }
  (reload ?? (() => globalThis.location.reload()))();
  return true;
}

/**
 * @param {Pick<Storage, 'removeItem'>} [storage]
 */
export function clearStaleChatAssetReload(storage) {
  try {
    (storage ?? globalThis.sessionStorage).removeItem(STALE_CHAT_ASSET_RELOAD_KEY);
  } catch {}
}

/**
 * One-line production detail. Never include stacks, tokens, or emails.
 * @param {unknown} error
 */
export function safeChatErrorDetail(error) {
  if (!(error instanceof Error) || !error.message.trim()) return '';
  const detail = error.message
    .replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .replace(/\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9]+/g, '[key]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!detail) return '';
  return detail.length > 160 ? `${detail.slice(0, 157)}…` : detail;
}

/**
 * Let the actual module import proceed when only a CSS preload failed.
 * The stylesheet is applied again by the module without `crossorigin`.
 * @param {EventTarget} [target]
 */
export function allowViteCssPreloadFallback(target = globalThis) {
  function onError(event) {
    if (!('payload' in event) || !isCssPreloadError(event.payload) || !event.cancelable) return;
    event.preventDefault();
  }
  target.addEventListener('vite:preloadError', onError);
  return () => target.removeEventListener('vite:preloadError', onError);
}
