import { assetPathname } from '../src/lib/public-url.mjs';

/** @param {Request} request @param {Record<string, string>} redirects */
export function routeRedirectResponse(request, redirects) {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url);
  let pathname;
  try { pathname = assetPathname(url.pathname); }
  catch (error) { if (error instanceof URIError) return null; throw error; }
  if (!Object.hasOwn(redirects, pathname)) return null;
  // The destination already has canonical casing, escaping and trailing slash.
  // Preserve the incoming query verbatim and keep redirects on this origin.
  return new Response(null, { status: 301, headers: { location: redirects[pathname] + url.search } });
}
