import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, parseFragment } from 'parse5';
import { assetPathname, publicURL, siteOrigin } from '../src/lib/public-url.mjs';

const siteHosts = new Set(['yindongliang.com', 'www.yindongliang.com']);

// Discover self-canonical HTML from the actual Astro output, including site-owned
// demos. Alias HTML points elsewhere and is excluded when verification repeats
// this inventory. Never follow symlinks or publish a private source identifier.
export async function publicHtmlRoutes(output) {
  const routes = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name === 'index.html') {
        const relative = path.relative(output, file).split(path.sep).slice(0, -1);
        const url = '/' + relative.map(encodeURIComponent).join('/') + (relative.length ? '/' : '');
        const html = await readFile(file, 'utf8');
        const head = parseFragment(/<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] || '');
        const canonicals = [];
        function links(node) {
          const attrs = Object.fromEntries((node.attrs || []).map(attr => [attr.name, attr.value]));
          if (node.tagName === 'link' && attrs.rel?.split(/\s+/).includes('canonical')) canonicals.push(attrs.href);
          for (const child of node.childNodes || []) links(child);
        }
        links(head);
        if (canonicals.length === 1 && canonicals[0] === publicURL(url)) routes.push({ url });
      }
    }
  }
  await visit(output);
  return routes.sort((a, b) => a.url.localeCompare(b.url));
}

// Use exact public route data, including explicit alias priority. Never infer a
// title or uppercase path segment, and never fold escaped bytes or fragments.
export function canonicalLink(href, base, routes, redirects) {
  let url, pathname;
  try {
    url = new URL(href, new URL(base, siteOrigin));
    if (!['http:', 'https:'].includes(url.protocol) || !siteHosts.has(url.hostname)) return null;
    pathname = assetPathname(url.pathname);
  } catch { return null; }
  const canonical = Object.hasOwn(redirects, pathname) ? redirects[pathname]
    : routes.has(pathname) ? pathname : routes.has(`${pathname}/`) ? `${pathname}/` : null;
  if (!canonical) return null; // Files and unknown paths are audited separately.
  if (url.pathname === canonical && url.origin === siteOrigin) return null;
  return canonical + url.search + url.hash;
}

export function canonicalizeHtmlLinks(html, base, routes, redirects) {
  const changes = [];
  function walk(node) {
    if (['pre', 'code'].includes(node.tagName)) return;
    if (node.tagName === 'a') {
      const href = node.attrs?.find(attr => attr.name === 'href')?.value;
      const location = node.sourceCodeLocation?.attrs?.href;
      if (href !== undefined && location) {
        const canonical = canonicalLink(href, base, routes, redirects);
        if (canonical !== null) {
          const escaped = canonical.replace(/[&"<>]/g, char => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char]);
          changes.push({ start: location.startOffset, end: location.endOffset, value: `href="${escaped}"` });
        }
      }
    }
    for (const child of node.childNodes || []) walk(child);
  }
  walk(parse(html, { sourceCodeLocationInfo: true }));
  for (const change of changes.sort((a, b) => b.start - a.start)) html = html.slice(0, change.start) + change.value + html.slice(change.end);
  return { html, changed: changes.length };
}

export async function canonicalizeOutputLinks(output, routes, redirects) {
  const canonical = new Set(routes.map(route => assetPathname(route.url)));
  let changed = 0;
  for (const url of canonical) {
    const filename = path.join(output, decodeURIComponent(url), 'index.html');
    const html = await readFile(filename, 'utf8');
    const result = canonicalizeHtmlLinks(html, url, canonical, redirects);
    if (result.changed) await writeFile(filename, result.html);
    changed += result.changed;
  }
  return changed;
}
