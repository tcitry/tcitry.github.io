/**
 * Locate a saved selection in article text.
 * Exact quote wins. Prefix and suffix break ties. Collapsed whitespace is the fallback.
 * @param {string} text
 * @param {string} quote
 * @param {string} [prefix]
 * @param {string} [suffix]
 * @returns {{start: number, end: number} | null}
 */
export function locateQuote(text, quote, prefix = '', suffix = '') {
  if (!quote) return null;
  return scan(text, quote, prefix, suffix) ?? locateNormalized(text, quote, prefix, suffix);
}

/**
 * @param {string} text
 * @param {string} quote
 * @param {string} prefix
 * @param {string} suffix
 */
function scan(text, quote, prefix, suffix) {
  let best = null;
  let bestScore = -1;
  let from = 0;
  for (let guard = 0; guard < 50; guard++) {
    const index = text.indexOf(quote, from);
    if (index < 0) break;
    const before = text.slice(Math.max(0, index - prefix.length), index);
    const after = text.slice(index + quote.length, index + quote.length + suffix.length);
    let score = 1;
    if (prefix) score += before === prefix ? 4 : prefix.length >= 8 && before.endsWith(prefix.slice(-16)) ? 2 : 0;
    if (suffix) score += after === suffix ? 4 : suffix.length >= 8 && after.startsWith(suffix.slice(0, 16)) ? 2 : 0;
    if (score > bestScore) {
      bestScore = score;
      best = {start: index, end: index + quote.length};
    }
    if (prefix && suffix && score >= 9) break;
    from = index + 1;
  }
  return best;
}

/**
 * @param {string} text
 */
function normalizeMap(text) {
  let norm = '';
  /** @type {number[]} */
  const map = [];
  let whitespaceAt = -1;
  for (let index = 0; index < text.length; index++) {
    if (/\s/u.test(text[index])) {
      if (whitespaceAt < 0 && norm.length > 0) whitespaceAt = index;
      continue;
    }
    if (whitespaceAt >= 0) {
      norm += ' ';
      map.push(whitespaceAt);
      whitespaceAt = -1;
    }
    norm += text[index];
    map.push(index);
  }
  return {norm, map};
}

/**
 * @param {string} text
 * @param {string} quote
 * @param {string} prefix
 * @param {string} suffix
 */
function locateNormalized(text, quote, prefix, suffix) {
  const source = normalizeMap(text);
  const needle = normalizeMap(quote).norm.trim();
  if (!needle || source.norm === text && needle === quote) return null;
  const found = scan(source.norm, needle, normalizeMap(prefix).norm.trim(), normalizeMap(suffix).norm.trim());
  if (!found) return null;
  const start = source.map[found.start];
  const last = source.map[found.end - 1];
  if (start === undefined || last === undefined || last + 1 <= start) return null;
  return {start, end: last + 1};
}
