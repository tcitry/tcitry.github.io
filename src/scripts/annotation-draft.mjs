/** @typedef {'underline' | 'highlight' | 'note'} AnnotationType */
/**
 * @typedef {{
 *   type: AnnotationType,
 *   pathname: string,
 *   title: string,
 *   quote: string,
 *   prefix: string,
 *   suffix: string,
 *   fresh: boolean,
 * }} AnnotationDraft
 */

const storageKey = 'blog-annotation-draft';
const types = new Set(['underline', 'highlight', 'note']);

/**
 * @param {unknown} value
 * @returns {AnnotationDraft | null}
 */
export function parseAnnotationDraft(value) {
  if (!value || typeof value !== 'object') return null;
  const draft = /** @type {Record<string, unknown>} */ (value);
  if (!types.has(/** @type {string} */ (draft.type))) return null;
  for (const key of ['pathname', 'title', 'quote', 'prefix', 'suffix']) {
    if (typeof draft[key] !== 'string') return null;
  }
  const quote = /** @type {string} */ (draft.quote);
  const pathname = /** @type {string} */ (draft.pathname);
  const title = /** @type {string} */ (draft.title);
  const prefix = /** @type {string} */ (draft.prefix);
  const suffix = /** @type {string} */ (draft.suffix);
  if (!quote.trim() || quote.length > 2_000) return null;
  if (prefix.length > 80 || suffix.length > 80) return null;
  if (!pathname.startsWith('/') || pathname.length > 1_024) return null;
  if (!title.trim() || title.length > 240) return null;
  return {
    type: /** @type {AnnotationType} */ (draft.type),
    pathname, title, quote, prefix, suffix,
    fresh: draft.fresh === true,
  };
}

/**
 * @param {Pick<Storage, 'getItem'>} storage
 * @returns {AnnotationDraft | null}
 */
export function readAnnotationDraft(storage) {
  try { return parseAnnotationDraft(JSON.parse(storage.getItem(storageKey) || 'null')); }
  catch { return null; }
}

/**
 * @param {Pick<Storage, 'setItem'>} storage
 * @param {unknown} draft
 */
export function saveAnnotationDraft(storage, draft) {
  const parsed = parseAnnotationDraft(draft);
  if (!parsed) return false;
  try { storage.setItem(storageKey, JSON.stringify(parsed)); return true; }
  catch { return false; }
}

/** @param {Pick<Storage, 'removeItem'>} storage */
export function clearAnnotationDraft(storage) {
  try { storage.removeItem(storageKey); } catch { /* private mode */ }
}

/** @type {AnnotationDraft[]} */
const pendingSaves = [];
/** @type {Set<() => void>} */
const saveListeners = new Set();
let replayedStoredMark = false;

/** @param {unknown} draft */
export function enqueueAnnotationSave(draft) {
  const parsed = parseAnnotationDraft(draft);
  if (!parsed || parsed.type === 'note') return false;
  pendingSaves.push(parsed);
  saveListeners.forEach(listener => listener());
  return true;
}

export function drainAnnotationSaves() {
  return pendingSaves.splice(0);
}

/** @param {() => void} listener */
export function subscribeAnnotationSaves(listener) {
  saveListeners.add(listener);
  return () => saveListeners.delete(listener);
}

/**
 * Replay a signed-out underline or highlight once after login.
 * Notes stay in draft storage for the notes panel.
 * @param {Pick<Storage, 'getItem'>} storage
 */
export function takeStoredMark(storage) {
  if (replayedStoredMark) return null;
  replayedStoredMark = true;
  const draft = readAnnotationDraft(storage);
  if (!draft || draft.type === 'note') return null;
  return draft;
}

export function resetAnnotationSaveState() {
  pendingSaves.splice(0);
  replayedStoredMark = false;
}
