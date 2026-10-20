/**
 * Teaching fixture for Ruflo 070349a, memory-bridge.ts:1418–1529.
 *
 * This runs synthetic memory rows in the browser, not Ruflo, SQLite or an
 * embedder. The 1000-row pre-rank window, BM25 parameters/normalization,
 * coverage floor, fusion, threshold comparison and top-10 ordering follow the
 * source. Unique update ranks avoid SQL timestamp ties. A/B/C text and cosine
 * values are illustrative inputs; only C's cosine changes with relevance.
 * No latency or production performance is measured.
 */
export const MEMORY_WINDOW_SIZE = 1000;
export const MEMORY_CORPUS_SIZE = 1100;
export const MEMORY_THRESHOLD = 0.2;
export const MEMORY_QUERY = 'token login';
export const MEMORY_QUERY_TERMS = MEMORY_QUERY.split(' ');
export const DEFAULT_MEMORY_INPUT = {
  position: 1001, relevance: 0.95, namespaceMatch: true,
  threshold: MEMORY_THRESHOLD, hasEmbedding: true,
};

export interface MemoryWindowInput {
  /** One-based update rank, newest first; A/B occupy ranks 1/2. */
  position: number;
  /** Fabricated C embedding cosine; no relationship to actual model quality. */
  relevance: number;
  namespaceMatch?: boolean;
  threshold?: number;
  hasEmbedding?: boolean;
}

export interface MemorySignals {
  semantic: number;
  /** BM25 normalized by 10 and capped at 1. */
  keyword: number;
  coverage: number;
  lexical: number;
  blended: number;
  score: number;
}

export interface MemoryCandidateRecord {
  id: string;
  text: string;
  /** Update rank, not relevance rank. */
  rank: number;
  namespace: 'patterns' | 'sessions';
  inWindow: boolean;
  semantic: number | null;
  keyword: number | null;
  bm25Normalized: number | null;
  coverage: number | null;
  lexical: number | null;
  blendedScore: number | null;
  score: number | null;
  passed: boolean;
  recalled: boolean;
  /** Relevance rank after thresholding; may exceed the top-10 result limit. */
  resultRank: number | null;
}

export type MemoryFixtureId = 'A' | 'B' | 'C';
export type MemoryFixtureRecord = MemoryCandidateRecord & {id: MemoryFixtureId};

export interface MemoryWindowResult {
  position: number;
  relevance: number;
  namespaceMatch: boolean;
  hasEmbedding: boolean;
  query: string;
  queryTokens: string[];
  targetText: string;
  matchedTerms: string[];
  namespace: 'patterns';
  targetNamespace: 'patterns' | 'sessions';
  corpusSize: number;
  namespaceSize: number;
  windowSize: number;
  threshold: number;
  inNamespace: boolean;
  inWindow: boolean;
  semantic: number | null;
  keyword: number | null;
  bm25Normalized: number | null;
  coverage: number | null;
  lexical: number | null;
  blended: number | null;
  blendedScore: number | null;
  score: number | null;
  passed: boolean;
  recalled: boolean;
  resultRank: number | null;
  reason: 'namespace' | 'window' | 'threshold' | 'limit' | 'recalled';
  /** A/B/C, including unscored C when outside the candidate window. */
  candidateRecords: MemoryFixtureRecord[];
  results: MemoryCandidateRecord[];
  eligibleCount: number;
  backgroundCount: number;
}

const BACKGROUND_TEXT = 'project status checkpoint routine';
const TARGET_TEXT = 'authorization session credentials';

function bounded(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

/** Exact fusion in upstream memory-bridge.ts:1496–1505. */
export function fuseMemorySignals(semantic: number, keyword: number, coverage: number): MemorySignals {
  const lexical = Math.max(keyword, coverage);
  const blended = 0.6 * Math.max(0, semantic) + 0.4 * lexical;
  return {semantic, keyword, coverage, lexical, blended, score: Math.max(blended, semantic)};
}

/** Upstream BM25 k1=1.2, b=.75, word substring TF and document substring DF. */
function normalizedBm25(queryTerms: string[], words: string[], stats: {
  averageLength: number; count: number; frequencies: Map<string, number>;
}): number {
  let raw = 0;
  for (const term of queryTerms) {
    const tf = words.filter(word => word === term || word.includes(term)).length;
    if (!tf) continue;
    const df = stats.frequencies.get(term) || 1;
    const idf = Math.log((stats.count - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * words.length / Math.max(1, stats.averageLength)));
    raw += idf * tfNorm;
  }
  return Math.min(raw / 10, 1);
}

export function evaluateMemoryWindow(input: MemoryWindowInput): MemoryWindowResult {
  const position = Math.round(bounded(input.position, 3, MEMORY_CORPUS_SIZE));
  const relevance = bounded(input.relevance, 0, 1);
  const namespaceMatch = input.namespaceMatch !== false;
  const hasEmbedding = input.hasEmbedding !== false;
  const threshold = bounded(input.threshold ?? MEMORY_THRESHOLD, 0, 1);

  const rows = Array.from({length: MEMORY_CORPUS_SIZE}, (_, index) => {
    const rank = index + 1;
    const id = rank === 1 ? 'A' : rank === 2 ? 'B' : rank === position ? 'C' : `background-${rank}`;
    const text = id === 'A' ? 'session credential access' : id === 'B' ? 'token login' : id === 'C' ? TARGET_TEXT : BACKGROUND_TEXT;
    const cosine = id === 'A' ? 0.72 : id === 'B' ? 0.1 : id === 'C' ? relevance : 0;
    const namespace: 'patterns' | 'sessions' = id === 'C' && !namespaceMatch ? 'sessions' : 'patterns';
    return {id, rank, text, cosine, namespace};
  });
  // Equivalent fixture pipeline: namespace filter → descending unique update
  // rank → LIMIT 1000. Neither gate depends on the eventual relevance score.
  const selected = rows.filter(record => record.namespace === 'patterns');
  const candidates = selected.slice(0, MEMORY_WINDOW_SIZE);
  const candidateIds = new Set(candidates.map(row => row.id));
  const words = candidates.map(row => row.text.toLowerCase().split(/\s+/));
  const stats = {
    count: words.length,
    averageLength: words.reduce((sum, doc) => sum + doc.length, 0) / words.length,
    frequencies: new Map(MEMORY_QUERY_TERMS.map(term => [
      term, candidates.filter(record => record.text.toLowerCase().includes(term)).length,
    ])),
  };
  const scored: MemoryCandidateRecord[] = rows.map(row => {
    let signals: MemorySignals | null = null;
    const inWindow = candidateIds.has(row.id);
    if (inWindow) {
      const rowWords = row.text.toLowerCase().split(/\s+/);
      const keyword = normalizedBm25(MEMORY_QUERY_TERMS, rowWords, stats);
      const coverage = MEMORY_QUERY_TERMS.filter(term => row.text.includes(term)).length / MEMORY_QUERY_TERMS.length;
      signals = fuseMemorySignals(hasEmbedding ? row.cosine : 0, keyword, coverage);
    }
    return {
      id: row.id, text: row.text, rank: row.rank, namespace: row.namespace, inWindow,
      semantic: signals?.semantic ?? null, keyword: signals?.keyword ?? null,
      bm25Normalized: signals?.keyword ?? null,
      coverage: signals?.coverage ?? null, lexical: signals?.lexical ?? null,
      blendedScore: signals?.blended ?? null, score: signals?.score ?? null,
      passed: signals !== null && signals.score >= threshold,
      recalled: false, resultRank: null,
    };
  });
  const eligible = scored.filter(record => record.passed).sort((a, b) => b.score! - a.score!);
  eligible.forEach((record, index) => {
    record.resultRank = index + 1;
    record.recalled = index < 10;
  });
  const results = eligible.slice(0, 10);
  const target = scored.find(record => record.id === 'C')!;
  return {
    position, relevance, namespaceMatch, hasEmbedding, query: MEMORY_QUERY,
    queryTokens: MEMORY_QUERY_TERMS, targetText: TARGET_TEXT, matchedTerms: [],
    namespace: 'patterns', targetNamespace: namespaceMatch ? 'patterns' : 'sessions',
    corpusSize: MEMORY_CORPUS_SIZE, namespaceSize: selected.length,
    windowSize: candidates.length, threshold,
    inNamespace: namespaceMatch, inWindow: target.inWindow,
    semantic: target.semantic, keyword: target.bm25Normalized,
    bm25Normalized: target.bm25Normalized, coverage: target.coverage,
    lexical: target.lexical, blended: target.blendedScore, blendedScore: target.blendedScore,
    score: target.score, passed: target.passed, recalled: target.recalled,
    resultRank: target.resultRank,
    reason: !namespaceMatch ? 'namespace' : !target.inWindow ? 'window' : !target.passed ? 'threshold' : !target.recalled ? 'limit' : 'recalled',
    candidateRecords: (['A', 'B', 'C'] as const).map(id => ({
      ...scored.find(record => record.id === id)!, id,
    })),
    results, eligibleCount: eligible.length,
    backgroundCount: candidates.filter(record => record.id.startsWith('background-')).length,
  };
}
