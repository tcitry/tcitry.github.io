import references from '../.generated/ai-search/references.json';
import { handleChat } from './chat.mjs';
import { handleRetrieval } from './retrieval.mjs';

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/internal/retrieve' || pathname === '/api/internal/retrieve/') return handleRetrieval(request, env, references);
    if (pathname === '/api/chat' || pathname === '/api/chat/') return handleChat(request, env, references);
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
    return env.ASSETS.fetch(request);
  },
};
