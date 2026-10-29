# tcitry-blog (yindongliang.com) 威胁模型

> 仓库：`tcitry/tcitry.github.io`（Astro + `@tcitry/astro-book`，Convex，Clerk，Cloudflare Workers）。本文依据代码和 `docs/member-services.md`、`docs/continuous-deployment.md`、`docs/ai-search.md` 起草，并结合作者的回答（2026-10-28）。它也是 Devin 安全扫描 profile「tcitry-blog threat model」使用的威胁模型，用于对扫描发现重新排序；修改时请同步两边。

## 用户确认的前提

- **资产**：下列资产全部同等重要，没有哪一类可以降级。
- **攻击者**：下列攻击者全部要考虑。
- **范围**：除「范围 / 接受的风险」里的 AI 成本和退订 token 两项以外，没有排除项。
- 因此重排只看威胁模型能否改变扫描器的判断；扫描器给出的严重度通常保持不变。

## 系统概览与信任边界

```
浏览器 ──(静态 HTML/JS)── Cloudflare Worker tcitry-blog（worker/index.ts，assets + /api/* 404）
   │
   ├─ Clerk（publishable key，modal / Google OAuth popup / One Tap）→ session JWT（aud=convex）
   ├─ Convex（`PUBLIC_CONVEX_URL`）：queries / mutations / actions + httpActions（convex/http.ts）
   │     ├─ Convex Agent → AI Search /search → Workers AI，经 Gateway tcitry-blog-chat
   │     └─ Resend（发邮件、newsletter audience、Svix 签名的 webhook）
   └─ AI Search 公开端点（匿名搜索）
构建：Workers Builds（main），GitHub Actions content-update.yml → CLOUDFLARE_DEPLOY_HOOK
```

信任边界：浏览器 ↔ Convex 公开函数，以及 HTTP 路由；Convex ↔ Clerk JWT（`convex/auth.config.ts`，issuer 为 `CLERK_FRONTEND_API_URL`）；Convex ↔ 第三方（Cloudflare API token、Resend）；CI/构建 ↔ 内容仓库 `tcitry/Blog`（作者控制的 MDX 在构建时执行）。

## 组件

| 组件 | 涵盖的代码 |
| --- | --- |
| **Static Site & Worker** | `worker/index.ts`、`wrangler.jsonc`、`src/pages/**`、`src/layouts/**`、`src/components/book/**`、`src/components/demos/**`、`src/components/search/**`、`src/lib/**`、`astro.config.mjs` |
| **Auth & Membership** | `convex/auth.config.ts`、`convex/membership.ts`、`convex/commentShared.ts`、`src/components/auth/**`、`src/components/membership/**` |
| **Reader Services** | `convex/comments.ts`、`convex/articleLikes.ts`、`convex/reader.ts`、`convex/notifications.ts`、`convex/commentImages.ts`、`convex/consultations.ts`、`convex/schema.ts`、`convex/http.ts`（comment-images 路由）、`src/components/{comments,reader,consultations,chat/AdminPanel*,chat/Notifications*}` |
| **AI Assistant** | `convex/assistant*.ts`、`src/components/chat/**`（除 Admin/Notifications 以外）、`src/pages/search/*.json.ts`、`src/lib/search-ai-client.ts`、`src/lib/ai-search-*` |
| **Email** | `convex/email*.ts`、`convex/http.ts`（`/email/unsubscribe`、`/resend/webhook`）、`src/pages/email/**`、`src/components/email/**` |
| **Build & Release** | `scripts/**`、`.github/workflows/**`、`package.json`、`convex/giscusImport.ts`、`tests/**` |

## 入口与可达方

- **匿名**：所有静态页面；Convex 公开 query/mutation（任何人拿到 `PUBLIC_CONVEX_URL` 都能直接调用，不经过 UI）；`comments.getSummary`；`emailPreferences.getByToken` / `unsubscribeByToken` / `updateByToken`（只凭 token）；`POST /email/unsubscribe`；`POST /resend/webhook`（Svix HMAC）；AI Search 公开端点。
- **已登录读者**（任何 Clerk 账户，可自助注册）：评论的增删、点赞、收藏、阅读标记与进度、通知、本人邮件偏好、AI 对话（免费，有限流）、图片上传与下载（`/comment-images/*`，校验 Origin，鉴权用 Bearer JWT）。
- **Pro 会员**：新建或继续咨询（`consultations.start` / `send`；从 JWT `pla` claim 判断）。
- **作者 / 管理员**：`tokenIdentifier === CONSULTATION_ADMIN_TOKEN_IDENTIFIER`，可用咨询收件箱与回复、`comments.listAdmin`、`articleLikes.listAdmin`，以及 `newComment` 邮件。
- **构建 / CI**：推送到 `main`、Blog 内容仓库通知、Workers Builds secrets（`CONVEX_DEPLOY_KEY`、AI Search 同步 token）。

## 资产（同等重要）

- 私人咨询消息与附件（付费、一对一）。
- 读者账户数据：评论正文、附件、收藏、喜欢、阅读标记与进度、通知、邮件地址（`cachedEmail`）与邮件偏好。
- 作者权限：收件箱、全部评论与喜欢的管理视图；冒充作者回复。
- AI 对话历史，以及 Workers AI / Gateway / AI Search 的用量与成本（`CLOUDFLARE_API_TOKEN`）。
- 邮件发送信誉与 Resend audience（`RESEND_API_KEY`），退订 token。
- 生产发布链路与 secrets（`CONVEX_DEPLOY_KEY`、`CLOUDFLARE_DEPLOY_HOOK`、Cloudflare token）。
- 站点完整性：生产域名上的 XSS 可窃取 Clerk session，从而访问以上所有资产。

## 攻击者（全部考虑）

1. 匿名互联网访客：直接调用 Convex 函数和 HTTP 路由，可以伪造 Origin，可以刷用量。
2. 已登录的恶意读者：IDOR / 越权读写他人数据，冒充作者，绕过 Pro，通过评论 markdown 或图片实施存储型 XSS，对 AI 做提示注入，刷 AI 用量。
3. Pro 会员：读取他人咨询，越权使用作者功能。
4. 供应链：npm 依赖、HeroUI Pro postinstall 下载、GitHub Actions、Blog 内容仓库的 MDX。

## 现有控制

- 身份只取自 `ctx.auth.getUserIdentity()`；文档规定不信任客户端提交的 ID、角色或 `isPro`（`convex/membership.ts`）。
- Pro：只认 v2 session 的 `pla` claim，个人 scope `u/ou/uo`，`sts` 必须为 active（`hasPersonalProPlan`）。
- 作者：精确比较 `tokenIdentifier`，值来自 Convex env。
- 附件：用途、归属与绑定检查（`accessibleImage`），Origin 白名单，类型加 magic bytes 校验，5 MB 上限，返回 `private, no-store` 和 `nosniff`，上传有限流。
- 限流：`@convex-dev/rate-limiter`，覆盖评论写入、喜欢、头像同步、AI 对话、上传。
- AI：工具预算（`TOOL_BUDGET`），只引用通过 `validatePublicChunk` / `references.json` 校验的公开文章，浏览器不能指定模型、Gateway 或系统提示。
- Resend webhook：Svix 签名校验（`verifySvixSignature`）。
- Worker 对 `/api/*` 一律返回 404；`check:public` 防止 secrets 进入 Git；生产构建在独立检出中进行（`production-release-guard`）。

## 范围 / 接受的风险

- 除下面列出的接受风险以外，没有排除项。`scripts/`、`tests/`、Labs/Demos 和 AI 回答质量同样在范围内。
- **AI 成本（作者确认，2026-10-28）**：Cloudflare 侧已经为 Workers AI 设置限额并开启 AI 限流，限额以内的消耗可以接受。因此只造成 AI / Gateway / AI Search 用量或成本上升的问题（例如自助注册后刷对话）不必关心；越权读取 AI 对话、绕过公开引用校验、泄露 `CLOUDFLARE_API_TOKEN` 仍在范围内。
- **退订 token（作者确认，2026-10-28）**：退订流程不影响 token 相关逻辑，作者接受现状。token 由 `newUnsubscribeToken` 生成，24 字节随机数（192 bit），没有有效期；`getByToken` 凭 token 返回 `cachedEmail`，作者认为可以接受。

## 已回答的问题

- `CHAT_ALLOWED_ORIGINS` 是 Convex 环境变量（`convex/convex.config.ts`），只由 `convex/commentImages.ts` 的 `permittedOrigin` 读取，也就是附件的 Origin 白名单（评论图片和咨询附件的 `/comment-images/upload`、`/comment-images/file`）。值可以是 JSON 数组，也可以是逗号分隔的列表。未设置时一律返回 403，失败是闭合的，所以这是可用性问题，不是安全问题。production 需要把它设成站点的 Origin。

## 开放问题

- 暂无。
