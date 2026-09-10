import { createProcessor } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { transformLegacyMarkdown } from '../../src/lib/markdown.mjs';

const parser = createProcessor({ remarkPlugins: [remarkGfm, remarkMath] });
const positions = (node) => [node.position.start.offset, node.position.end.offset];

/** Accept legacy HTML comments without rewriting comment-like text inside
 * fenced/inline code, JavaScript, or JSX attributes. The first parse uses
 * equal-length whitespace so AST offsets still address the original source. */
function convertHtmlComments(source) {
  const comments = [...source.matchAll(/<!--[\s\S]*?-->/g)];
  if (!comments.length) return source;
  let masked = source;
  for (const match of [...comments].reverse()) masked = masked.slice(0, match.index) + match[0].replace(/[^\r\n]/g, ' ') + masked.slice(match.index + match[0].length);
  const protectedRanges = [];
  function visit(node) {
    if (['code', 'inlineCode', 'mdxjsEsm', 'mdxFlowExpression', 'mdxTextExpression'].includes(node.type)) { protectedRanges.push(positions(node)); return; }
    for (const attribute of node.attributes ?? []) if (attribute.position) protectedRanges.push(positions(attribute));
    node.children?.forEach(visit);
  }
  visit(parser.parse(masked));
  let result = source;
  for (const match of [...comments].reverse()) {
    const start = match.index, end = start + match[0].length;
    if (protectedRanges.some(([left, right]) => start >= left && end <= right)) continue;
    const comment = match[0].slice(4, -3).replaceAll('*/', '* /');
    result = result.slice(0, start) + `{/*${comment}*/}` + result.slice(end);
  }
  return result;
}

/** MDX is trusted authoring code, but its imports must stay in site components.
 * BLOG_DIR is never a Vite root or an import search path. */
function validateImports(tree, source) {
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' && node.source || node.type === 'ExportAllDeclaration') {
      const target = node.source?.value;
      if (typeof target !== 'string' || !/^@\/components\/[A-Za-z0-9_./-]+$/.test(target) || target.split('/').some(part => !part || part.startsWith('.') || /^(?:private|node_modules)$/i.test(part))) {
        throw new Error(`Unsupported MDX import in ${source}: ${target}. Import site components with @/components/...; Blog-relative, filesystem and package imports are not supported.`);
      }
    }
    if (node.type === 'ImportExpression') throw new Error(`Dynamic imports are not supported in Blog MDX: ${source}. Import a site component with @/components/... instead.`);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  // ESTree also includes expressions in component props and inline content.
  walk(tree);
}

/** Produce searchable prose without executing modules or serializing props.
 * AST positions preserve the original tables, code fences and Markdown inside
 * JSX containers. Imports, expressions, and JSX tags are omitted from metadata;
 * Astro compiles the complete source separately for the actual page. */
export function prepareMdx(body, source, resolve, warnings = []) {
  const compiledSource = convertHtmlComments(transformLegacyMarkdown(body, source, resolve, warnings, { normalizeMath: false }));
  const tree = parser.parse(compiledSource);
  validateImports(tree, source);
  const edits = [];
  function omit(node) {
    const [start, end] = positions(node);
    const replacement = node.type === 'mdxFlowExpression' && node.value.trim() === '/*more*/' ? '\n<!--more-->\n' : node.type === 'mdxTextExpression' ? '' : '\n';
    edits.push([start, end, replacement]);
  }
  function visit(node) {
    if (['mdxjsEsm', 'mdxFlowExpression', 'mdxTextExpression'].includes(node.type)) { omit(node); return; }
    if (['mdxJsxFlowElement', 'mdxJsxTextElement'].includes(node.type)) {
      if (!node.children.length) { omit(node); return; }
      const [start, end] = positions(node);
      const separator = node.type === 'mdxJsxFlowElement' ? '\n' : '';
      edits.push([start, node.children[0].position.start.offset, separator]);
      edits.push([node.children.at(-1).position.end.offset, end, separator]);
    }
    node.children?.forEach(visit);
  }
  visit(tree);
  let prose = compiledSource;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) prose = prose.slice(0, start) + replacement + prose.slice(end);
  return { compiledSource, prose, filename: createHash('sha256').update(source).digest('hex') + '.mdx' };
}

/** Synchronize only final public pages; remove modules that became drafts,
 * disappeared, or were suppressed by a legacy route collision. */
export async function syncMdxModules(directory, modules) {
  await mkdir(directory, { recursive: true });
  const names = new Set(modules.map(({ filename }) => filename));
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && /\.mdx$/.test(entry.name) && !names.has(entry.name)) await unlink(path.join(directory, entry.name));
  }
  for (const { filename, compiledSource } of modules) {
    if (!/^[a-f0-9]{64}\.mdx$/.test(filename)) throw new Error('Invalid generated MDX filename');
    const target = path.join(directory, filename);
    const previous = await readFile(target, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (previous === compiledSource) continue;
    const temporary = target + `.${process.pid}.tmp`;
    await writeFile(temporary, compiledSource);
    await rename(temporary, target);
  }
}
