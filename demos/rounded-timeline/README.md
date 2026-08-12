# Rounded timeline demo

This Vite project produces the public, CSS Module based demo embedded in the
Blog article. The build artifact belongs in the Blog content repository so a
content update publishes both the article and its preview.

```sh
npm install
DEMO_OUT_DIR=/absolute/path/to/Blog/static/demos/rounded-timeline npm run build
```

With no `DEMO_OUT_DIR`, Vite writes to this directory's ignored `dist/` folder.
