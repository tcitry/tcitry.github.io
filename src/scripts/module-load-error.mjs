/** Vite rejects the whole dynamic import if a CSS preload link errors. */

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
 * @param {unknown} error
 */
export function chatLoadFailureCopy(error) {
  if (isClerkLoadError(error)) return '登录服务暂时无法连接，请稍后重试。';
  if (isAssetLoadError(error)) return '助手未能加载。若页面刚更新，请刷新后再试。';
  return '助手未能加载，请检查网络后重试。';
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
