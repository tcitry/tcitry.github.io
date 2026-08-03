# Repository Notes

## Giscus comments

- Keep `data-mapping="og:title"` in `layouts/partials/docs/inject/content-after.html`.
- Existing GitHub Discussions are keyed by each page's Open Graph title. Changing the mapping to `pathname` without migrating those discussions makes their existing comments disappear from the site.
- If a future migration to `pathname` is required, first update every existing Discussion title to include both its current title and the exact page `pathname` (including the trailing slash), verify both mappings, then switch the template and deploy.
