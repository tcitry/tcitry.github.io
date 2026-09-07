import { createBookProcessor } from '@tcitry/astro-book/markdown';
import path from 'node:path';

export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const aliases = { assembly: 'asm', promql: 'text', mysql: 'sql', react: 'jsx', objective: 'objective-c', objectivec: 'objective-c', objc: 'objective-c', 'c++': 'cpp', gdb: 'text', corefile: 'text', xcconfig: 'text', gitattributes: 'text', fstab: 'text' };
const visit = (node, callback) => { callback(node); if (node.children) for (const child of node.children) visit(child, callback); };

/** CommonMark's code handler appends a newline even to an unclosed EOF fence.
 * Preserve the author's semantic code (dedented by Markdown) and actual final line ending.
 */
export function remarkBlogCodeSource() {
  return (tree, file) => visit(tree, (node) => {
    if (node.type !== 'code' || !node.position) return;
    const markdown = String(file.value);
    const raw = markdown.slice(node.position.start.offset, node.position.end.offset).replace(/\r\n?/g, '\n');
    const lines = raw.split('\n');
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0]);
    let finalNewline;
    if (fence) {
      const closing = lines.at(-1).replace(/^(?:[ \t]*>[ \t]*)+/, '').trimStart();
      const closed = new RegExp(`^${fence[1][0]}{${fence[1].length},}[ \\t]*$`).test(closing) && lines.length > 1;
      finalNewline = closed ? lines.length > 2 : raw.endsWith('\n');
    } else {
      finalNewline = raw.endsWith('\n') || /[\r\n]/.test(markdown[node.position.end.offset] ?? '');
    }
    node.data = {...node.data, hChildren: [{type: 'text', value: node.value + (finalNewline ? '\n' : '')}]};
  });
}

/** Mark both imported Markdown and native MDX for the site's optional Pro renderer.
 * Keep source in one real pre/code node: no JSON duplicate, HTML injection or trim.
 */
export function rehypeBlogCodeBlocks() {
  const classes = (node) => Array.isArray(node.properties?.className) ? node.properties.className : String(node.properties?.className ?? '').split(/\s+/);
  const isIsland = (node) => ['data-demo', 'data-book-island', 'data-blog-code', 'dataDemo', 'dataBookIsland', 'dataBlogCode'].some((name) => node.properties?.[name] !== undefined || node.attributes?.some((attribute) => attribute.name === name));
  return (tree) => {
    function walk(parent) {
      if (!parent.children || isIsland(parent)) return;
      parent.children = parent.children.map((node) => {
        if (isIsland(node)) return node;
        if (node.type !== 'element' || node.tagName !== 'pre' || classes(node).includes('mermaid') || node.properties?.['data-book-mermaid'] !== undefined) {
          walk(node); return node;
        }
        const code = node.children?.find((child) => child.tagName === 'code');
        // Old raw HTML can contain a bare pre as well as a normal fenced code block.
        const language = String(node.properties?.dataLanguage ?? node.properties?.['data-language'] ?? classes(code ?? node).find((name) => String(name).startsWith('language-'))?.slice(9) ?? 'text').toLowerCase();
        return {
          type: 'element', tagName: 'div', properties: { 'data-blog-code': '', 'data-blog-code-language': language, className: ['blog-code-block'] },
          children: [{ type: 'element', tagName: 'div', properties: { 'data-blog-code-fallback': '' }, children: [
            { type: 'element', tagName: 'div', properties: { className: ['blog-code-header'], 'data-pagefind-ignore': '' }, children: [
              { type: 'element', tagName: 'span', properties: {}, children: [{ type: 'text', value: language }] },
              { type: 'element', tagName: 'span', properties: { className: ['blog-code-action-space'], 'aria-hidden': 'true' }, children: [] },
            ] }, node,
          ] }],
        };
      });
    }
    walk(tree);
  };
}
function remarkLegacyBlocks() {
  return (tree) => visit(tree, (node) => {
    if (node.type === 'blockquote') {
      const firstText = node.children?.[0]?.children?.[0];
      const alert = firstText?.type === 'text' ? /^\[!([a-z]+)\][ \t]*(?:\n|$)/i.exec(firstText.value) : null;
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, className: ['book-hint', ...(alert ? [alert[1].toLowerCase()] : [])] } };
      if (alert) firstText.value = firstText.value.slice(alert[0].length);
    }
    if (node.type !== 'code') return;
    const language = (node.lang ?? '').toLowerCase();
    node.lang = aliases[language] ?? language;
  });
}

// KaTeX's former DOM auto-renderer could not pair dollars across <strong>,
// <code>, link destinations, or HTML tags. Protect numeric currency at those
// boundaries before remark-math gets a chance to consume intervening Markdown.
function protectUnpairedCurrency(text) {
  const dollars = [...text.matchAll(/(?<![\\$])\$(?!\$)/g)];
  if (dollars.length % 2 === 0) return text;
  const last = dollars.at(-1).index;
  return /^\d/.test(text.slice(last + 1)) ? text.slice(0, last) + '\\' + text.slice(last) : text;
}
function normalizeProseMath(text, hasCodeBoundary = false) {
  const pieces = text.split(/(\]\((?:\\.|[^\\)])*\)|<[^>\n]+>)/g);
  return pieces.map((piece, index) => {
    if (index % 2) return piece; // Markdown URLs and HTML attributes are not math.
    const emphasis = piece.split(/(\*\*|__)/g);
    return emphasis.map((span, part) => {
      if (part % 2) return span;
      const safe = emphasis.length > 1 || pieces.length > 1 || hasCodeBoundary ? protectUnpairedCurrency(span) : span;
      return safe.replace(/\\\((.+?)\\\)/g, (_, formula) => '$' + formula + '$')
        .replace(/\\\[(.+?)\\\]/g, (_, formula) => '\n$$\n' + formula + '\n$$\n');
    }).join('');
  }).join('');
}

/** Resolve legacy relref only in prose, preserving fenced/inline code examples. */
export function transformLegacyMarkdown(markdown, source, resolver, warnings = []) {
  let fence = null;
  return markdown.split('\n').map((line) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return line;
    }
    if (fence || /^ {4}|^\t/.test(line)) return line;
    if (/^\s{0,3}\\[\[\]]\s*$/.test(line)) return '$$';
    const pieces = line.split(/(`+[^`]*`+)/g);
    return pieces.map((piece, index) => {
      if (index % 2) return piece;
      return normalizeProseMath(piece, pieces.length > 1).replace(/(?<!\\)\{\{[<%]\s*relref\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))\s*[>%]\}\}/g, (original, double, single, bare) => {
        const target = double ?? single ?? bare;
        const url = resolver(target, source);
        if (url) return url;
        warnings.push(`Unresolved relref in ${source}: ${target}`);
        return original.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      });
    }).join('');
  }).join('\n');
}
export function createReferenceResolver(pages) {
  const bySource = new Map(pages.filter((p) => p.source).map((page) => [page.source, page]));
  const byRoute = new Map(pages.map((page) => [decodeURI(page.url), page]));
  const baseNames = new Map();
  for (const page of pages) {
    if (!page.source) continue;
    const base = path.posix.basename(page.source);
    const values = baseNames.get(base) ?? [];
    values.push(page); baseNames.set(base, values);
  }
  return (target, current) => {
    const [pathname, hash = ''] = target.split('#');
    if (!pathname && hash) return '#' + hash;
    let decoded;
    try { decoded = decodeURI(pathname); } catch { decoded = pathname; }
    const clean = decoded.replace(/^\/+/, '').replace(/^\.\//, '');
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(current), clean));
    const candidates = [clean, relative].flatMap((candidate) => [candidate, candidate + '.md', candidate + '/_index.md', candidate + '/index.md']);
    const page = candidates.map((candidate) => bySource.get(candidate)).find(Boolean) ?? byRoute.get('/' + clean.replace(/\/?$/, '/')) ?? (baseNames.get(path.posix.basename(clean))?.length === 1 ? baseNames.get(path.posix.basename(clean))[0] : null);
    return page ? page.url + (hash ? '#' + hash : '') : null;
  };
}
export async function createLegacyMarkdownRenderer() {
  const renderer = await createBookProcessor({ code: false, remarkPlugins: [remarkLegacyBlocks, remarkBlogCodeSource], rehypePlugins: [rehypeBlogCodeBlocks] }).createRenderer({ syntaxHighlight: false });
  return async (markdown, fileURL) => {
    const result = await renderer.render(markdown, { fileURL });
    return { html: result.code, headings: result.metadata.headings };
  };
}
export function plainText(html) {
  return html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (entity) => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]).replace(/\s+/g, ' ').trim();
}
