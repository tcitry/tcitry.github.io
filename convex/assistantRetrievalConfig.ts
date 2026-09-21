import defaults from '../src/lib/ai-search-retrieval-options.json';

export const RETRIEVAL = defaults.retrieval;
export const RERANKING = defaults.reranking;
export const QUERY_REWRITE = defaults.query_rewrite;
export const CACHE = defaults.cache;

export function searchRetrievalOptions({queryRewrite}: {queryRewrite?: boolean} = {}) {
  return {
    retrieval: RETRIEVAL,
    query_rewrite: queryRewrite === false ? {enabled: false as const} : QUERY_REWRITE,
    reranking: RERANKING,
    cache: CACHE,
  };
}
