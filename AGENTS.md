# Repository Notes

## Astro validation branch

- `astro` contains the Astro migration. The current production/default branch is `master`; `hugo-book` preserves the committed Hugo source. Production promotion is a separate migration step.
- Use `npm run setup` for a clean checkout to prepare the pinned `@tcitry/astro-book` package before installing the site's locked dependencies. The theme is maintained in its independent public repository; use its public exports rather than copying its implementation into this site.
- `BLOG_DIR` is a read-only content source. Keep private content, generated files, credentials and installed commercial component code out of Git. React/HeroUI Pro demo wrappers belong to this site, not the public theme.
- After theme or rendering changes, run the site's build, check, tests and verify commands. Preserve the legacy route baseline and Giscus pathname terms.
- Astro Giscus configuration and page eligibility live in `src/layouts/BookLayout.astro`; the theme renders comments after footer navigation. The Hugo-specific paths below continue to apply to the Hugo implementation.

## Giscus comments

- Inject Giscus from `layouts/partials/docs/inject/footer.html` so the footer's previous/next navigation stays above the comments. Keep `data-mapping="pathname"` unless an audited migration explicitly changes it.
- Inject Giscus only for `.IsPage`; Docs section index pages such as `/docs/Apple/` have pathname prefixes that can fuzzy-match descendant Discussions.
- Existing GitHub Discussions retain their legacy page title and include the Giscus pathname term. The term is the client-side `location.pathname.substring(1)` value: it has no leading `/`, preserves URL percent-encoding and the trailing `/`; the root page uses `index`.
- When a page title changes but its final pathname term does not, verify the rendered page but normally leave its Discussion unchanged. When its slug, permalink, directory or section changes, update the existing Discussion title to retain both the old and final pathname terms before publishing.
- Use `/Users/yindongliang/Blog/skills/giscus-discussion-compatibility/SKILL.md` for audits and remote updates. Prefer GitHub MCP; fall back to authenticated GitHub GraphQL only after producing an auditable mapping plan. Do not create or delete Discussions, or change their body, category, state, comments or reactions during a mapping maintenance task.
- URL aliases and redirects are independent from Giscus matching. Do not add them solely for comment migration unless the user asks to preserve historical links.
