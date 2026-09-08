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

`dev` imports Blog once at startup, then watches its public Markdown and assets. Saving, adding, renaming, or deleting a source updates the running site and reloads the browser. Imports are debounced and run serially; after an import error, fix the source and save again. `BLOG_DIR` stays read-only. The full-text Pagefind index still requires a build; `preview` serves the existing build and does not watch content.

## Verify and publish

```sh
BLOG_DIR=/path/to/Blog npm run build:production
npm run check
npm test
BLOG_DIR=/path/to/Blog npm run verify:release
npm run preview -- --port 4321
```

Review the resulting site locally, then use `npm run deploy:verified` from the isolated release checkout. It checks the recorded source and asset hashes without rebuilding. Wrangler uses `wrangler.jsonc`. [Workers Builds](docs/continuous-deployment.md#workers-builds) is connected to the site repository. Cloud builds select the latest content `main` commit once per build; no manually maintained content SHA is required. Content-update notifications can request a build through a repository Deploy Hook secret. Confirm successful cloud deployment in the build history.

Ordinary `npm run build` creates a local preview with `noindex`. Production builds and verification apply the public site's indexing policy.

## Repository boundaries

Keep the fixed theme commit in `astro-book.source.json` aligned with `package-lock.json`. Publish theme changes in the independent theme repository before updating the pinned source here.

Keep private content, secrets, generated files, and installed commercial component source out of this public repository. `.gitignore` covers local caches, reports, and environment files; sanitized environment templates may be committed.

## Documentation

- [Local preview and verification](docs/astro-preview.md)
- [Demo authoring](docs/demo-authoring.md)
- [Build and deployment](docs/continuous-deployment.md)
