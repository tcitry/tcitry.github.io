export function articleProgress(articleTop: number, articleHeight: number, viewHeight: number) {
  if (!Number.isFinite(articleTop) || !Number.isFinite(articleHeight) || !Number.isFinite(viewHeight) || articleHeight <= 0 || viewHeight <= 0) return 0;
  const distance = articleHeight - viewHeight;
  if (distance <= 0) return articleTop <= 1 ? 1 : 0;
  const ratio = -articleTop / distance;
  if (ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  return ratio;
}
