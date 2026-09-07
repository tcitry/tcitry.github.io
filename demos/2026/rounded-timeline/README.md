# Rounded timeline demo

This Vite + Tailwind CSS v4 project produces the public demo embedded in the
Blog article. It intentionally imports Tailwind's theme and utility layers but
omits Preflight, because the demo is displayed in an isolated iframe. The build
artifact belongs in the Blog content repository so a content update publishes
both the article and its preview.

```sh
npm ci
DEMO_OUT_DIR=/absolute/path/to/Blog/static/demos/2026/rounded-timeline npm run build
```

With no `DEMO_OUT_DIR`, Vite writes to this directory's ignored `dist/` folder.
