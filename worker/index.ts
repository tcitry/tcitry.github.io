import redirects from '../dist/route-redirects.json';
import retirements from '../dist/route-retirements.json';
import { routeRedirectResponse, routeRetirementResponse } from './route-redirects.mjs';

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
    const redirect = routeRedirectResponse(request, redirects);
    if (redirect) return redirect;
    const retired = routeRetirementResponse(request, retirements);
    if (retired) return retired;
    return env.ASSETS.fetch(request);
  },
};
