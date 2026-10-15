/** Estimate reading time from CJK-aware word count (~400 characters per minute). */
export function readingMinutes(wordCount, charsPerMinute = 400) {
  if (!Number.isFinite(wordCount) || wordCount < 1) return 0;
  return Math.max(1, Math.ceil(wordCount / charsPerMinute));
}
