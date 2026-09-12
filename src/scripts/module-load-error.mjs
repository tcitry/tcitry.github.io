/** Vite rejects the whole dynamic import if a CSS preload link errors. */

export const CHAT_LOAD_RETRY_DELAY_MS = 400;

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
  if (!(error instanceof Error)) return false;
  return isCssPreloadError(error)
    || /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(error.message);
}

/**
 * @param {unknown} error
 */
export function isClerkLoadError(error) {
  if (!(error instanceof Error)) return false;
  return error.message.includes('Clerk:') || ('clerkError' in error && error.clerkError === true);
}

/**
 * A first failure is often a stale hashed chunk, a CSS preload, or a race
 * while SearchCommand unmounts and the assistant root mounts.
 * @param {unknown} error
 */
export function isRetriableChatLoadError(error) {
  if (isClerkLoadError(error) || isAssetLoadError(error)) return true;
  if (error instanceof TypeError) return true;
  return error instanceof Error && /ChunkLoadError/i.test(error.name);
}

/**
 * @param {unknown} error
 * @param {'import' | 'mount'} [phase]
 */
export function chatLoadFailureCopy(error, phase = 'import') {
  if (isClerkLoadError(error)) return '登录服务暂时无法连接，请稍后重试。';
  if (isAssetLoadError(error)) return '助手未能加载。若页面刚更新，请刷新后再试。';
  if (phase === 'mount' || error instanceof TypeError) return '助手未能打开，请重试。';
  return '助手未能加载，请检查网络后重试。';
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
