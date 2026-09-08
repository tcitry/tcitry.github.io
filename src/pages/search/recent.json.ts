import type {APIRoute} from 'astro';
import {content} from '../../lib/site';
import {getRecentUpdates} from '../../lib/search-recent';

export const prerender = true;

// A stable URL prevents recent-date changes from rewriting every page's HTML.
export const GET: APIRoute = () => new Response(JSON.stringify(getRecentUpdates(content.pages)), {
  headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache'},
});
