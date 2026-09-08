import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import astroBook from '@tcitry/astro-book';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import sentry from '@sentry/astro';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rehypeBlogCodeBlocks, remarkBlogCodeSource } from './src/lib/markdown.mjs';

const production = process.env.PUBLIC_SITE_ENV === 'production';
const uploadSourceMaps = production && Boolean(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);
const release = process.env.SENTRY_RELEASE || `tcitry-blog@${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}`;

export default defineConfig({
  site: 'https://yindongliang.com',
  output: 'static',
  trailingSlash: 'always',
  publicDir: './astro-public',
  build: { format: 'directory' },
  // Keep exact static source; the site's Pro renderer adds highlighting near the viewport.
  markdown: { syntaxHighlight: false },
  integrations: [astroBook({
    search: { glob: '{docs,posts,weekly}/**/*.html', rootSelector: 'main' },
    markdown: { code: false, remarkPlugins: [remarkBlogCodeSource], rehypePlugins: [rehypeBlogCodeBlocks] },
  }), react(), svelte(), sentry({
    enabled: { client: production, server: false },
    autoInstrumentation: { requestHandler: false },
    telemetry: false,
    unstable_sentryVitePluginOptions: { release: { name: release } },
    sourcemaps: {
      disable: !uploadSourceMaps,
      filesToDeleteAfterUpload: ['./dist/**/*.map'],
    },
  })],
  vite: {
    define: { 'import.meta.env.PUBLIC_SENTRY_RELEASE': JSON.stringify(release) },
    plugins: [tailwindcss()],
    // These renderers are imported on demand, including on pages without React islands.
    optimizeDeps: { include: ['@heroui-pro/react/code-block', '@heroui-pro/react/command'] },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  },
});
