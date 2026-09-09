import { cp, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const denied = /^(?:\.|private$|node_modules$)/i;

async function copyTree(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (denied.test(entry.name) || entry.isSymbolicLink()) continue;
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await cp(from, to);
  }
}

export function resolveKatexDist(themeEntry = import.meta.resolve('@tcitry/astro-book')) {
  const requireTheme = createRequire(fileURLToPath(themeEntry));
  return path.join(path.dirname(requireTheme.resolve('katex/package.json')), 'dist');
}

/** Hugo Book served theme icons at /icons/; the current site canonical path is /book-icons/. */
export async function publishIconAliases(output, themeIcons) {
  const icons = path.join(output, 'icons');
  await copyTree(themeIcons, icons);
  await cp(path.join(output, 'favicon.ico'), path.join(icons, 'favicon.ico'));
}

/** Hugo served KaTeX from /katex/; current pages bundle it, but that public URL still receives requests. */
export async function publishKatexAssets(output, katexDist) {
  const katex = path.join(output, 'katex');
  await mkdir(path.join(katex, 'fonts'), { recursive: true });
  await cp(path.join(katexDist, 'katex.min.css'), path.join(katex, 'katex.min.css'));
  await cp(path.join(katexDist, 'katex.min.js'), path.join(katex, 'katex.min.js'));
  await copyTree(path.join(katexDist, 'fonts'), path.join(katex, 'fonts'));
}
