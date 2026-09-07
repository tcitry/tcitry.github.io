import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse, parseFragment } from 'parse5';

const siteHosts = new Set(['yindongliang.com', 'www.yindongliang.com']);
const decode = value => { try { return decodeURIComponent(value); } catch { return value; } };
const attribute = (node, name) => node.attrs?.find(attr => attr.name === name)?.value;
function walk(node, visit, skipCode = false) {
  if (skipCode && ['pre', 'code'].includes(node.tagName)) return;
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit, skipCode);
}

/** Check rendered Markdown links against the files and redirects being deployed. */
export async function auditContentLinks({ pages, output, redirects = [], site = 'https://yindongliang.com' }) {
  const root = path.resolve(output);
  // An exact file inventory avoids false positives on case-insensitive macOS disks.
  // Symlinks are excluded, so the audit cannot read outside the deployment output.
  const files = new Set();
  async function inventory(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await inventory(target);
      else if (entry.isFile()) files.add(path.relative(root, target).split(path.sep).join('/'));
    }
  }
  await inventory(root);
  const redirectMap = new Map(redirects.map(rule => [decode(new URL(rule.from, site).pathname), rule.to]));
  const anchors = new Map();
  async function hasAnchor(file, fragment) {
    if (!anchors.has(file)) {
      const ids = new Set();
      walk(parse(await readFile(path.join(root, file), 'utf8')), node => {
        const id = attribute(node, 'id');
        if (id !== undefined) ids.add(id);
        if (node.tagName === 'a') {
          const name = attribute(node, 'name');
          if (name !== undefined) ids.add(name);
        }
      });
      anchors.set(file, ids);
    }
    const ids = anchors.get(file);
    // Some Markdown footnote IDs contain literal percent escapes themselves.
    return ids.has(fragment) || ids.has(decode(fragment));
  }
  function destination(url) {
    const pathname = decode(url.pathname);
    const absolute = path.resolve(root, `.${pathname}`);
    if (pathname.includes('\0') || (absolute !== root && !absolute.startsWith(root + path.sep))) {
      return { reason: 'path escapes output' };
    }
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const candidates = pathname.endsWith('/')
      ? [relative ? `${relative}/index.html` : 'index.html']
      : [relative, `${relative}/index.html`, `${relative}.html`];
    return { file: candidates.find(candidate => files.has(candidate)) };
  }
  const errors = [];
  let checkedLinks = 0;
  for (const page of pages) {
    const hrefs = [];
    walk(parseFragment(page.html || ''), node => {
      if (node.tagName === 'a') {
        const href = attribute(node, 'href');
        if (href !== undefined) hrefs.push(href);
      }
    }, true);
    for (const href of hrefs) {
      const fail = reason => errors.push({ source: page.source || page.id || page.url, url: page.url, href, reason });
      let url;
      try { url = new URL(href, new URL(page.url, site)); }
      catch { fail('invalid URL'); continue; }
      if (!['https:', 'http:'].includes(url.protocol) || !siteHosts.has(url.hostname)) continue;
      checkedLinks++;
      const seen = new Set();
      let redirectError = false;
      while (['https:', 'http:'].includes(url.protocol) && siteHosts.has(url.hostname) && redirectMap.has(decode(url.pathname))) {
        const key = decode(url.pathname);
        if (seen.has(key)) { fail('redirect cycle'); redirectError = true; break; }
        seen.add(key);
        const target = redirectMap.get(key);
        const next = new URL(target, url);
        // HTTP redirects inherit the original fragment when Location omits one.
        if (!target.includes('#')) next.hash = url.hash;
        url = next;
      }
      if (redirectError || !['https:', 'http:'].includes(url.protocol) || !siteHosts.has(url.hostname)) continue;
      const { file, reason } = destination(url);
      if (reason || !file) { fail(reason || `missing target: ${url.pathname}`); continue; }
      const fragment = url.hash.slice(1).split(':~:')[0];
      if (!fragment || decode(fragment).toLowerCase() === 'top' || !/\.html$/i.test(file)) continue;
      if (!await hasAnchor(file, fragment)) fail(`missing fragment: ${url.pathname}#${fragment}`);
    }
  }
  return { errors, checkedLinks, checkedPages: pages.length };
}
