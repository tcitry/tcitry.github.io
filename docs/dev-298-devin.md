# DEV-298 — Devin handoff

Linear: https://linear.app/manaio/issue/DEV-298

**Canonical plan (Claude 定版):** [`docs/dev-298-impl-guide.md`](./dev-298-impl-guide.md)

Older Linear comments are derivation only; if they conflict with the 定版 guide, ignore them.

## Your job
1. **Review** the 定版 plan against `main` (after `4494bf7` / current tip). Your engineering judgment wins over Claude where you disagree — document disagreements in the PR before coding large deviations.
2. **Implement** per the agreed slices (S0 probes → tool loop → Workers AI generation → retire AI Search `/chat/completions` from the hot path). Prefer shipping incremental PRs if slices are large; this seed PR may become the first implementation PR.
3. Keep security: `validatePublicChunk` / `references.json`; no unvalidated URLs to the model or client.
4. Do not change production secrets via Dashboard unless the plan requires documenting env vars (`ASSISTANT_CHAT_MODEL`, existing `CLOUDFLARE_*` on Convex).
