/** A deliberately small teaching model, not a replacement for ClawHub's schema. */
export interface DigestFields {
  displayName: 'Alpha' | 'Beta';
  downloads: number;
  updatedAt: number;
}

export type DigestOperation = 'ready' | 'patch' | 'noop' | 'query-miss' | 'query-hit' | 'delete' | 'rebuild';
export interface DigestMachineState {
  source: DigestFields;
  digest: DigestFields | null;
  revision: number;
  cache: {key: string; revision: number; result: DigestFields | null} | null;
  receipt: {revision: number; result: DigestFields | null} | null;
  writes: number;
  skippedWrites: number;
  queryRuns: number;
  cacheHits: number;
  operation: DigestOperation;
  sequence: number;
}

export const INITIAL_UPDATED_AT = 1_700_000_000_000;
export const PUBLIC_QUERY_KEY = 'listPublicPageV4:{sort:"downloads",numItems:1}:anonymous';
const copy = (fields: DigestFields | null): DigestFields | null => fields ? {...fields} : null;

export function createDigestMachine(): DigestMachineState {
  const source: DigestFields = {displayName: 'Alpha', downloads: 10, updatedAt: INITIAL_UPDATED_AT};
  return {
    source, digest: {...source}, revision: 0, cache: null, receipt: null,
    writes: 0, skippedWrites: 0, queryRuns: 0, cacheHits: 0,
    operation: 'ready', sequence: 0,
  };
}

/** Mirrors the source guard over only the three fields retained in this model. */
export function hasProjectedChange(existing: DigestFields | null, fields: DigestFields): boolean {
  if (!existing) return true;
  for (const key of Object.keys(fields) as Array<keyof DigestFields>) {
    if (existing[key] === fields[key]) continue;
    if (JSON.stringify(existing[key]) !== JSON.stringify(fields[key])) return true;
  }
  return false;
}

export function projectDigest(state: DigestMachineState, fields: DigestFields = state.source): DigestMachineState {
  if (!Number.isSafeInteger(fields.downloads) || fields.downloads < 0 || !Number.isSafeInteger(fields.updatedAt)) {
    throw new RangeError('Teaching fields must use nonnegative integer downloads and an integer updatedAt.');
  }
  const changed = hasProjectedChange(state.digest, fields);
  return {
    ...state, source: {...fields}, digest: changed ? {...fields} : state.digest,
    revision: state.revision + Number(changed), writes: state.writes + Number(changed),
    skippedWrites: state.skippedWrites + Number(!changed), operation: changed ? 'patch' : 'noop',
    sequence: state.sequence + 1,
  };
}

/** A wrapped Mutation is represented as one atomic state transition. */
export function commitDigestFields(state: DigestMachineState, displayName: DigestFields['displayName'], downloads: number): DigestMachineState {
  const changed = state.source.displayName !== displayName || state.source.downloads !== downloads;
  return projectDigest(state, {
    displayName, downloads,
    // This deterministic timestamp is teaching data, not production time or a cache TTL.
    updatedAt: state.source.updatedAt + (changed ? 60_000 : 0),
  });
}

/** Models an anonymous Query that reads only this digest, excluding real hydration fallbacks. */
export function readDigest(state: DigestMachineState, key = PUBLIC_QUERY_KEY): DigestMachineState {
  const hit = state.cache?.key === key && state.cache.revision === state.revision;
  const result = copy(hit ? state.cache!.result : state.digest);
  return {
    ...state, cache: {key, revision: state.revision, result: copy(result)},
    receipt: {revision: state.revision, result}, queryRuns: state.queryRuns + Number(!hit),
    cacheHits: state.cacheHits + Number(hit), operation: hit ? 'query-hit' : 'query-miss',
    sequence: state.sequence + 1,
  };
}

/** Removing a materialized projection is a maintenance error, not ordinary cache eviction. */
export function removeDigest(state: DigestMachineState): DigestMachineState {
  return {
    ...state, digest: null, revision: state.revision + Number(state.digest !== null),
    operation: 'delete', sequence: state.sequence + 1,
  };
}

export function rebuildDigest(state: DigestMachineState): DigestMachineState {
  const next = projectDigest(state);
  return {...next, operation: next.operation === 'patch' ? 'rebuild' : 'noop'};
}

export function receiptIsStale(state: DigestMachineState): boolean {
  return state.receipt !== null && state.receipt.revision !== state.revision;
}

export function digestStatus(state: DigestMachineState): string {
  switch (state.operation) {
    case 'patch': return '字段改变：已更新 digest';
    case 'noop': return '字段相同：跳过 digest 写入';
    case 'query-miss': return state.digest ? 'Query 重新求值：已发出 one-shot 收据' : 'Query 重新求值：列表缺少这一项';
    case 'query-hit': return '教学缓存命中：复用同一依赖版本';
    case 'delete': return 'digest 已误删；源记录仍在';
    case 'rebuild': return '已从源记录重建 digest';
    default: return '源记录与 digest 一致；等待第一次读取';
  }
}
