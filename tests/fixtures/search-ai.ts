import '../../src/styles/tailwind.css';
import './search-ai.css';

type SearchRequest = {
  url: string;
  query: string;
  credentials?: RequestCredentials;
  aborted: boolean;
  settled: boolean;
};

const calls: SearchRequest[] = [];
const originalFetch = window.fetch.bind(window);
const searchEndpoint = new URL(import.meta.env.PUBLIC_AI_SEARCH_URL ?? '').href;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url, location.origin).href !== searchEndpoint) return originalFetch(input, init);
  const body = JSON.parse(String(init?.body ?? '{}'));
  const query = body.query ?? body.messages?.at(-1)?.content ?? '';
  const call = {url, query, credentials: init?.credentials, aborted: Boolean(init?.signal?.aborted), settled: false};
  calls.push(call);
  init?.signal?.addEventListener('abort', () => {call.aborted = true;}, {once: true});
  try {
    // A transport that completes after cancellation must also be harmless. All
    // other queries use the real browser AbortSignal and network cancellation.
    return await originalFetch(input, query.endsWith('-ignored') ? {...init, signal: undefined} : init);
  } finally {call.settled = true;}
};
Object.assign(window, {__searchAi: {calls, pagefindCalls: []}});

void import('../../src/scripts/blog-search').then(() => {document.documentElement.dataset.searchFixtureReady = 'true';});
