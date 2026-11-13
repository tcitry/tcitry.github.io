import { assetPathname } from '../src/lib/public-url.mjs';

/** @param {Request} request @param {Record<string, number>} retirements */
export function routeRetirementResponse(request, retirements) {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  let pathname;
  try { pathname = assetPathname(new URL(request.url).pathname); }
  catch (error) { if (error instanceof URIError) return null; throw error; }
  if (!Object.hasOwn(retirements, pathname)) return null;
  const status = retirements[pathname];
  return new Response(request.method === 'HEAD' ? null : status === 410 ? 'Gone' : 'Not found', {
    status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

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
