/** Cover rendered under the title on a detail page.
 * Weekly list cards and Open Graph already use frontmatter `image`.
 * The custom meta block that replaced theme ArticleMeta stopped emitting it.
 */
export function articleCover(page) {
  const src = String(page?.image ?? '').trim();
  if (!src) return null;
  return { src, alt: String(page?.title ?? '') };
}
