export const siteOrigin = 'https://yindongliang.com';

/**
 * Spell a pathname the way Workers static assets serve it directly: each
 * segment in encodeURIComponent form. Any other spelling (a raw `+`, `:`, `@`,
 * lowercase escapes) is answered with a 307 to this form.
 *
 * @param {string} pathname
 * @returns {string}
 */
export function assetPathname(pathname) {
  return new URL(pathname, siteOrigin).pathname.split('/').map(segment => encodeURIComponent(decodeURIComponent(segment))).join('/');
}

/**
 * Absolute final URL for a site pathname, used for canonical, og:url, sitemap and feeds.
 *
 * @param {string} pathname
 * @returns {string}
 */
export function publicURL(pathname) {
  return siteOrigin + assetPathname(pathname);
}
