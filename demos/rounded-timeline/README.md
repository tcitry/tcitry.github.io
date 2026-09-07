# Rounded timeline demo

This demo is an Astro page in the blog application. Its existing public URL,
`/demos/2026/rounded-timeline/`, also remains the article's iframe URL.

- Component: [`src/components/demos/RoundedTimeline.astro`](../../src/components/demos/RoundedTimeline.astro)
- Route: [`src/pages/demos/2026/rounded-timeline/index.astro`](../../src/pages/demos/2026/rounded-timeline/index.astro)
- Page layout: [`src/layouts/DemoLayout.astro`](../../src/layouts/DemoLayout.astro)

The page renders all four cards into static HTML, uses the site's Tailwind
utilities for the original visual design, and observes layout changes to keep
the active rail aligned with the heading and final card. The full-page demo
layout keeps the embedded preview separate from the Book sidebar.

Run from the repository root:

```sh
npm run dev
```

Open `/demos/2026/rounded-timeline/` on the development server. The root
`npm run build` generates the published page together with the blog.
