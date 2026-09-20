import defaults from './ai-search-retrieval-options.json' with {type: 'json'};

export const RETRIEVAL = defaults.retrieval;
export const QUERY_REWRITE = defaults.query_rewrite;
export const RERANKING = defaults.reranking;
export const CACHE = defaults.cache;

/** Mirrors convex/assistantRetrievalConfig.searchRetrievalOptions for scripts and tests. */
export function searchRetrievalOptions({queryRewrite} = {}) {
  return {
    retrieval: RETRIEVAL,
    query_rewrite: queryRewrite === false ? {enabled: false} : QUERY_REWRITE,
    reranking: RERANKING,
    cache: CACHE,
  };
}

/** Mirrors convex/assistantRetrievalConfig.chatRetrievalOptions for scripts and tests. */
export function chatRetrievalOptions(approvedHashes) {
  return {
    retrieval: {
      ...RETRIEVAL,
      filters: {content_hash: {$in: approvedHashes}},
    },
    query_rewrite: QUERY_REWRITE,
    reranking: RERANKING,
    cache: CACHE,
  };
}
