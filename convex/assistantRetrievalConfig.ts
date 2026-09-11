export const RETRIEVAL = {
  retrieval_type: 'hybrid' as const,
  max_num_results: 10,
  match_threshold: 0.4,
  return_on_failure: false,
};

export const RERANKING = {
  enabled: true as const,
  model: '@cf/baai/bge-reranker-base' as const,
};

export const QUERY_REWRITE = {enabled: true as const};
export const CACHE = {enabled: true as const};

export function chatRetrievalOptions(approvedHashes: string[]) {
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

export function searchRetrievalOptions({queryRewrite}: {queryRewrite?: boolean} = {}) {
  return {
    retrieval: RETRIEVAL,
    query_rewrite: queryRewrite === false ? {enabled: false as const} : QUERY_REWRITE,
    reranking: RERANKING,
    cache: CACHE,
  };
}
