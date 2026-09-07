import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import astroBook from '@tcitry/astro-book';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { rehypeBlogCodeBlocks, remarkBlogCodeSource } from './src/lib/markdown.mjs';

export default defineConfig({
  site: 'https://yindongliang.com',
  output: 'static',
  trailingSlash: 'always',
  publicDir: './astro-public',
  build: { format: 'directory' },
  // Keep exact static source; the site's Pro renderer adds highlighting near the viewport.
  markdown: { syntaxHighlight: false },
  integrations: [astroBook({ markdown: { code: false, remarkPlugins: [remarkBlogCodeSource], rehypePlugins: [rehypeBlogCodeBlocks] } }), react(), svelte()],
  vite: {
    plugins: [tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  },
});
