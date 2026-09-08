import { defineConfig } from 'astro/config';
import { blogChatDev } from './scripts/lib/chat-dev.mjs';
import { blogContentDev } from './scripts/lib/content-dev.mjs';
import react from '@astrojs/react';
import astroBook from '@tcitry/astro-book';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import sentry from '@sentry/astro';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rehypeBlogCodeBlocks, remarkBlogCodeSource } from './src/lib/markdown.mjs';
import { loadReaderEnvironment, readProductionReaderConfig } from './scripts/reader-config.mjs';
import { readerBuildIntegration } from './scripts/reader-build.mjs';

const production = process.env.PUBLIC_SITE_ENV === 'production';
const readerEnv = loadReaderEnvironment(fileURLToPath(new URL('.', import.meta.url)), process.env, production ? 'production' : 'development');
const readerConfig = production ? readProductionReaderConfig(readerEnv) : {
  clerkPublishableKey: readerEnv.PUBLIC_CLERK_PUBLISHABLE_KEY || '',
  convexUrl: readerEnv.PUBLIC_CONVEX_URL || readerEnv.CONVEX_URL || '',
};
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
  integrations: [readerBuildIntegration({ root: fileURLToPath(new URL('.', import.meta.url)), production, readerConfig }), astroBook({
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
    define: {
      'import.meta.env.PUBLIC_SENTRY_RELEASE': JSON.stringify(release),
      'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify(readerConfig.clerkPublishableKey),
      'import.meta.env.PUBLIC_CONVEX_URL': JSON.stringify(readerConfig.convexUrl),
    },
    plugins: [tailwindcss(), blogChatDev(), blogContentDev()],
    // These renderers are imported on demand, including on pages without React islands.
    optimizeDeps: { include: ['@heroui-pro/react/code-block', '@heroui-pro/react/command'] },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  },
});
