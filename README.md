# tcitry-blog

[Live site](https://yindongliang.com) · [Labs](https://yindongliang.com/labs/) · [astro-book](https://github.com/tcitry/astro-book)

A static personal blog built with Astro and the independently maintained `@tcitry/astro-book` theme. Markdown content lives in a separate content workspace and is imported read-only during builds.

Cloudflare Workers Static Assets serves the site through a single production Worker. Labs contains interactive experiments with React, HeroUI, HeroUI Pro, and Svelte; site-specific pages and components stay in this repository.

## Development

Requires Node.js 22.12+, npm, Git, and authorized access to HeroUI Pro.

```sh
npm run setup
BLOG_DIR=/path/to/Blog npm run dev
```

`setup` prepares the pinned theme package before installing locked dependencies. Use `package.json` as the source of truth for development, build, and deployment commands.

## Verify and publish

```sh
BLOG_DIR=/path/to/Blog npm run build:production
npm run check
npm test
npm run verify:production
npm run preview -- --port 4321
```

Review the resulting site locally before following the [manual deployment workflow](docs/continuous-deployment.md). Wrangler uses the default `wrangler.jsonc`; repository pushes do not automatically deploy the blog.

Ordinary `npm run build` creates a local preview with `noindex`. Production builds and verification apply the public site's indexing policy.

## Repository boundaries

Keep the fixed theme commit in `astro-book.source.json` aligned with `package-lock.json`. Publish theme changes in the independent theme repository before updating the pinned source here.

Keep private content, secrets, generated files, and installed commercial component source out of this public repository. `.gitignore` covers local caches, reports, and environment files; sanitized environment templates may be committed.

## Documentation

- [Local preview and verification](docs/astro-preview.md)
- [Demo authoring](docs/demo-authoring.md)
- [Build and deployment](docs/continuous-deployment.md)
