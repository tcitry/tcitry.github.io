import type {APIRoute} from 'astro';
import references from '../../../.generated/ai-search/references.json';
import {publicSearchReferences} from '../../lib/search-ai-client';

export const prerender = true;

// Project an explicit public allowlist: no article bodies, source paths or
// repository revision metadata are copied from the generated corpus.
export const GET: APIRoute = ({site}) => new Response(JSON.stringify({
  documents: publicSearchReferences(references, site!.origin),
}), {headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache'}});
