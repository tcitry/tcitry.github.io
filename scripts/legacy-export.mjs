/** One-time, auditable Hugo URL export. Normal Astro builds never invoke Hugo. */
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { collectSources, publicSources, routeSignature } from './legacy-content.mjs';

const root = path.resolve(process.env.BLOG_DIR || path.join(homedir(), 'Blog'));
const temporary = await mkdtemp(path.join(tmpdir(), 'blog-public-route-audit-'));
try {
  const records = publicSources(await collectSources(root));
  await mkdir(path.join(temporary, 'layouts'), { recursive: true });
  for (const record of records) {
    const target = path.join(temporary, 'content', record.source.replace(/\.mdx$/, '.md'));
    await mkdir(path.dirname(target), { recursive: true });
    // Deliberately copy only already-public frontmatter. Never mount or scan Blog in Hugo.
    await writeFile(target, `---\n${YAML.stringify(record.data)}---\n`);
  }
  await writeFile(path.join(temporary, 'hugo.toml'), `baseURL = "https://yindongliang.com"\ntitle = "LYon's Blog"\ndisablePathToLower = true\nhasCJKLanguage = true\ndefaultContentLanguage = "zh"\nenableGitInfo = false\ndisableKinds = ["RSS", "sitemap"]\n[permalinks]\nposts = "/posts/:slug/"\n[outputs]\nhome = ["HTML", "JSON"]\n`);
  await writeFile(path.join(temporary, 'layouts/index.json'), `{{- $pages := slice -}}\n{{- range $sortPosition, $page := .Site.Pages -}}\n{{- $source := "" -}}{{- with .File -}}{{- $source = .Path -}}{{- end -}}\n{{- $parent := "" -}}{{- with .Parent -}}{{- $parent = .RelPermalink -}}{{- end -}}\n{{- $pages = $pages | append (dict "sortPosition" $sortPosition "source" $source "url" .RelPermalink "title" .Title "kind" .Kind "section" .Section "type" .Type "layout" .Layout "date" (.Date.Format "2006-01-02T15:04:05Z07:00") "parent" $parent "weight" .Weight "aliases" .Aliases) -}}\n{{- end -}}\n{{- $pages | jsonify -}}`);
  execFileSync('hugo', ['--source', temporary, '--destination', path.join(temporary, 'output'), '--quiet'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const pages = JSON.parse(await readFile(path.join(temporary, 'output/index.json'), 'utf8'));
  const sources = new Map(records.map((record) => [record.source, record]));
  for (const page of pages) {
    const record = sources.get(page.source);
    if (record) page.routeSignature = routeSignature(record);
  }
  const result = { version: 1, generatedAt: new Date().toISOString(), hugoVersion: execFileSync('hugo', ['version'], { encoding: 'utf8' }).trim(), description: 'Public frontmatter only; no Blog content or credentials included. Hugo is not required for normal builds.', pages: pages.sort((a, b) => a.url.localeCompare(b.url) || a.source.localeCompare(b.source)) };
  await writeFile(process.env.LEGACY_EXPORT_OUTPUT || new URL('./legacy-routes.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(`Exported ${pages.length} legacy routes from ${records.length} public source files.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
