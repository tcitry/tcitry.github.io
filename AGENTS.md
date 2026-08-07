# Repository Notes

## Giscus comments

- Keep `data-mapping="pathname"` in `layouts/partials/docs/inject/content-after.html` unless an audited migration explicitly changes it.
- Inject Giscus only for `.IsPage`; Docs section index pages such as `/docs/Apple/` have pathname prefixes that can fuzzy-match descendant Discussions.
- Existing GitHub Discussions retain their legacy page title and include the Giscus pathname term. The term is the client-side `location.pathname.substring(1)` value: it has no leading `/`, preserves URL percent-encoding and the trailing `/`; the root page uses `index`.
- When a page title changes but its final pathname term does not, verify the rendered page but normally leave its Discussion unchanged. When its slug, permalink, directory or section changes, update the existing Discussion title to retain both the old and final pathname terms before publishing.
- Use `/Users/yindongliang/Blog/skills/giscus-discussion-compatibility/SKILL.md` for audits and remote updates. Prefer GitHub MCP; fall back to authenticated GitHub GraphQL only after producing an auditable mapping plan. Do not create or delete Discussions, or change their body, category, state, comments or reactions during a mapping maintenance task.
- URL aliases and redirects are independent from Giscus matching. Do not add them solely for comment migration unless the user asks to preserve historical links.
