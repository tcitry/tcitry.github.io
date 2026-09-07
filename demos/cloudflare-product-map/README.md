# Cloudflare documentation learning map

This static React/Kumo demo is part of the Astro blog. It keeps the original
13 documentation links and public URL, `/demos/2026/cloudflare-product-map/`.
Astro renders the complete map as HTML; the links work without hydration.

- Component: [`CloudflareProductMap.tsx`](../../src/components/demos/CloudflareProductMap.tsx)
- Styles: [`CloudflareProductMap.module.css`](../../src/components/demos/CloudflareProductMap.module.css), using Tailwind CSS v4 utilities
- Route: [`index.astro`](../../src/pages/demos/2026/cloudflare-product-map/index.astro)

```sh
# From the blog repository root:
npm run setup
npm run dev
```

Open `http://127.0.0.1:4321/demos/2026/cloudflare-product-map/`.
The normal blog build includes this page. It no longer needs a separate Vite
project or a generated copy in the Blog content repository.

The demo retains `@cloudflare/kumo`'s `LayerCard` and `Badge` components and its
standalone stylesheet. Styles load on this route only. It makes no API calls.
