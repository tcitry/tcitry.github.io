import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { parseFragment } from 'parse5';

export const SITE_ORIGIN = 'https://yindongliang.com';
export const MANAGED_PREFIX = 'tcitry-blog/articles/';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const jsonBytes = value => JSON.stringify(value, null, 2) + '\n';
const allowedTypes = new Set(['docs', 'posts', 'weekly']);
const enabled = value => value === true || typeof value === 'string' && value.trim().toLowerCase() === 'true';
const attrs = node => Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
const parameter = (page, name) => Object.entries(page.params ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
const date = value => value && !String(value).startsWith('0001') && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
const plain = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(plain).join('');
const escapeText = value => value.replace(/[\\`*_\[\]<>]/g, '\\$&');

export function canonicalURL(route) {
  assert.equal(typeof route, 'string', 'Article route must be a string');
  assert.ok(route.startsWith('/') && !route.startsWith('//') && !/[\\\s\u0000-\u001f\u007f]/u.test(route), 'Invalid article route');
  const url = new URL(route, SITE_ORIGIN);
  assert.ok(url.origin === SITE_ORIGIN && !url.search && !url.hash, 'Article URL must be a canonical site pathname');
  assert.ok(/^\/(?:docs|posts|weekly)\/.+\/$/.test(url.pathname), 'Article URL must be an independent public article');
  assert.ok(!decodeURIComponent(url.pathname).split('/').some(part => part === '..' || part === '.'), 'Invalid canonical path');
  return url.href;
}

/** Convert rendered public HTML, never raw frontmatter or the private source tree. */
export function articleMarkdown(html, canonical) {
  const tree = parseFragment(html);
  function convert(node, language = '') {
    if (node.nodeName === '#text') return escapeText(node.value.replace(/\s+/g, ' '));
    if (node.nodeName === '#comment') return '';
    const tag = node.tagName;
    const attributes = attrs(node);
    const classes = (attributes.class ?? '').split(/\s+/);
    if (['script', 'style', 'template', 'button', 'input', 'select', 'textarea', 'nav', 'iframe', 'svg', 'canvas'].includes(tag)
      || Object.hasOwn(attributes, 'hidden') || attributes['aria-hidden'] === 'true'
      || Object.hasOwn(attributes, 'data-demo') || Object.hasOwn(attributes, 'data-book-island')
      || classes.includes('anchor') || Object.hasOwn(attributes, 'data-pagefind-ignore')) return '';
    const childLanguage = attributes['data-blog-code-language'] || language;
    const content = () => (node.childNodes ?? []).map(child => convert(child, childLanguage)).join('');
    if (tag === 'pre') {
      const code = (node.childNodes ?? []).find(child => child.tagName === 'code');
      const codeClass = attrs(code ?? node).class ?? '';
      const info = attributes['data-language'] || /(?:^|\s)language-([^\s]+)/.exec(codeClass)?.[1] || childLanguage || (classes.includes('mermaid') ? 'mermaid' : 'text');
      const text = plain(code ?? node).replace(/\r\n?/g, '\n');
      const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
      const fence = '`'.repeat(longest + 1);
      return `\n\n${fence}${info.replace(/[^a-zA-Z0-9_+.-]/g, '')}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}\n\n`;
    }
    if (tag === 'code') {
      const value = plain(node);
      const fence = '`'.repeat(Math.max(0, ...[...value.matchAll(/`+/g)].map(match => match[0].length)) + 1);
      return `${fence} ${value} ${fence}`;
    }
    if (/^h[1-6]$/.test(tag ?? '')) return `\n\n${'#'.repeat(Number(tag[1]))} ${content().trim()}\n\n`;
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'a') {
      const label = content();
      try {
        const url = new URL(attributes.href, canonical);
        if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return `[${label}](<${url.href}>)`;
      } catch { /* Preserve the label when the original link is malformed. */ }
      return label;
    }
    if (tag === 'img') return attributes.alt ? escapeText(attributes.alt) : '';
    if (tag === 'blockquote') return `\n\n${content().trim().split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
    if (tag === 'ul' || tag === 'ol') {
      return '\n\n' + (node.childNodes ?? []).filter(child => child.tagName === 'li').map((child, index) => {
        const marker = tag === 'ol' ? `${index + 1}. ` : '- ';
        return marker + convert(child, childLanguage).trim().replace(/\n/g, '\n' + ' '.repeat(marker.length));
      }).join('\n') + '\n\n';
    }
    if (tag === 'table') {
      const rows = [];
      function visit(row) {
        if (row.tagName === 'tr') rows.push((row.childNodes ?? []).filter(cell => ['th', 'td'].includes(cell.tagName)).map(cell => convert(cell, childLanguage).trim().replace(/\n+/g, ' ').replace(/\|/g, '\\|')));
        else for (const child of row.childNodes ?? []) visit(child);
      }
      visit(node);
      if (!rows.length) return '';
      const width = Math.max(...rows.map(row => row.length));
      const line = row => '| ' + Array.from({ length: width }, (_, index) => row[index] ?? '').join(' | ') + ' |';
      return '\n\n' + [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n') + '\n\n';
    }
    if (['p', 'div', 'section', 'article', 'details', 'summary', 'figure', 'figcaption', 'dl', 'dt', 'dd'].includes(tag)) return '\n\n' + content().trim() + '\n\n';
    return content();
  }
  // Do not normalize blank lines inside fenced code. They are source data.
  return convert(tree).trim();
}

export function createCorpus(pages, { environment = 'preview', revision = { siteCommit: null, contentCommit: null } } = {}) {
  const documents = [];
  const seen = new Set();
  for (const page of pages) {
    if (page.kind !== 'page' || !allowedTypes.has(page.type) || enabled(page.hidden) || enabled(page.redirect)
      || enabled(parameter(page, 'draft')) || enabled(parameter(page, 'bookHidden')) || enabled(parameter(page, 'bookSearchExclude'))
      || typeof page.html !== 'string' || !page.html.trim()) continue;
    const url = canonicalURL(page.url);
    const title = String(parameter(page, 'linkTitle') || parameter(page, 'bookTitle') || page.title || '').trim();
    assert.ok(title, 'Indexed articles must have a display title');
    const body = articleMarkdown(page.html, url);
    if (!body.trim()) continue;
    const decoded = decodeURI(url);
    assert.ok(!seen.has(decoded), 'Duplicate canonical article URL');
    seen.add(decoded);
    const id = sha256(url);
    const sourceKind = (page.tags ?? []).some(tag => String(tag).toLowerCase() === 'byai') ? 'ai-assisted' : 'author';
    const metadata = { title, url, section: page.type, date: date(page.date), updatedAt: date(page.lastmod) || date(page.date), sourceKind };
    const markdown = [
      `# ${escapeText(title)}`, `原文地址：${url}`, `栏目：${page.type}`,
      ...(metadata.date ? [`发布日期：${metadata.date}`] : []),
      ...(metadata.updatedAt ? [`更新日期：${metadata.updatedAt}`] : []),
      sourceKind === 'ai-assisted' ? '来源类型：ByAI — 本文整理自与 AI 的对话，请辨别核实。' : '来源类型：作者文章',
      body,
    ].join('\n\n') + '\n';
    documents.push({ id, key: `${MANAGED_PREFIX}${id}.md`, hash: sha256(markdown), ...metadata, markdown });
  }
  documents.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const references = { version: 1, revision, documents: documents.map(({ markdown, ...reference }) => reference) };
  const manifest = { ...references, environment, corpusHash: sha256(jsonBytes(references.documents)) };
  return { documents, references, manifest };
}

/** Check all document bytes before sealing or sending a single remote mutation. */
export async function readCorpus(directory) {
  const [manifestBytes, referenceBytes] = await Promise.all([
    readFile(path.join(directory, 'manifest.json')), readFile(path.join(directory, 'references.json')),
  ]);
  const manifest = JSON.parse(manifestBytes);
  const references = JSON.parse(referenceBytes);
  assert.equal(manifest.version, 1, 'Unsupported AI Search corpus version');
  assert.deepEqual(references, { version: 1, revision: manifest.revision, documents: manifest.documents }, 'AI Search references differ from corpus manifest');
  assert.equal(manifest.corpusHash, sha256(jsonBytes(manifest.documents)), 'AI Search corpus manifest hash mismatch');
  const keys = new Set();
  const documents = [];
  for (const reference of manifest.documents) {
    assert.equal(reference.url, canonicalURL(new URL(reference.url).pathname), 'AI Search corpus has a foreign URL');
    assert.equal(reference.id, sha256(reference.url), 'AI Search document ID differs from URL');
    assert.equal(reference.key, `${MANAGED_PREFIX}${reference.id}.md`, 'AI Search object key is outside the managed namespace');
    assert.ok(!keys.has(reference.key), 'Duplicate AI Search object key');
    keys.add(reference.key);
    const filename = path.join(directory, 'documents', `${reference.id}.md`);
    assert.ok((await lstat(filename)).isFile(), 'AI Search document must be a regular file');
    const markdown = await readFile(filename, 'utf8');
    assert.equal(sha256(markdown), reference.hash, 'AI Search document changed after export');
    documents.push({ ...reference, markdown });
  }
  return { manifest, references, documents, seal: { corpusHash: manifest.corpusHash, manifestHash: sha256(manifestBytes), referencesHash: sha256(referenceBytes), count: documents.length } };
}

export async function assertCorpusRelease(root, release) {
  const corpus = await readCorpus(path.join(root, '.generated/ai-search'));
  assert.equal(corpus.manifest.environment, 'production', 'Only production articles can be synchronized');
  assert.equal(corpus.manifest.revision.siteCommit, release.siteCommit, 'Corpus site revision differs from release');
  assert.equal(corpus.manifest.revision.contentCommit, release.contentCommit, 'Corpus content revision differs from release');
  for (const document of corpus.documents) {
    const asset = decodeURIComponent(new URL(document.url).pathname).replace(/^\//, '') + 'index.html';
    assert.ok(Object.hasOwn(release.assets, asset), 'Corpus contains an article absent from the verified production assets');
  }
  return corpus;
}
