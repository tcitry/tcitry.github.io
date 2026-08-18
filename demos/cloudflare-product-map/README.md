# Cloudflare documentation learning map

This is a public, static Kumo proof of concept for the Cloudflare overview
page. It links to the site's own Cloudflare documentation through a guided
learning path; it is not a Cloudflare product directory or network diagram.

The source remains in the site repository; its build artifact belongs in the
Blog content repository so Hugo can publish it at
`/demos/2026/cloudflare-product-map/`.

```sh
npm install
DEMO_OUT_DIR=/Users/yindongliang/Blog/static/demos/2026/cloudflare-product-map npm run build
```

The production page contains no API calls, login, telemetry, private data, or
external runtime dependency. Product names and destinations are drawn from the
official Cloudflare developer documentation and directory.
