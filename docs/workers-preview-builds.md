# Workers Builds 预览部署

非 `main` 分支的 push 和 pull request 可以通过 Cloudflare Workers Builds 生成 **Version URL** 预览。预览 Worker 不承接生产流量，前端连接 **共享 staging Convex** 与 **Clerk development（`pk_test_`）**，且 **不会** 同步 AI Search 索引或写入生产 Convex（`hushed-mallard-700`）。

## 命令

| 分支 | 构建命令 | 部署命令 |
| --- | --- | --- |
| `main` | `npm run build:workers` | `npm run deploy:verified` |
| 其他分支 | `npm run build:preview` | `npm run deploy:preview` |

`build:workers` / `deploy:verified` 在非 `main` 分支会立即失败；`build:preview` / `deploy:preview` 在 `main` 分支或 `PREVIEW_*` 指向生产配置时会立即失败。Workers Builds 的生产与非生产分支 **共享** 同一组变量与密钥，因此预览构建会 **忽略并剥离** 环境中的 `CONVEX_DEPLOY_KEY`（`prod:`）、`wrangler.jsonc` 生产 `PUBLIC_*`、`AI_SEARCH_PUBLIC_URL` 与 Cloudflare/Clerk 凭据，只使用 `PREVIEW_*` 映射出的 staging 值；任何子进程（npm、Astro、Convex CLI、Wrangler）都不会收到生产 deploy key。

Workers Builds 通过 `WORKERS_CI_BRANCH` 识别分支（见 [Cloudflare 文档](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#environment-variables)）。

## 预览流程

1. `build:preview`：检出私有 Blog 内容，以 `PUBLIC_SITE_ENV=preview` 构建 noindex 站点，校验 staging reader 配置，封存 `.generated/preview-build.json`。
2. `deploy:preview`：用 staging deploy key 将 Convex functions 部署到共享 staging deployment；随后执行 `wrangler versions upload`，用 `--var` 覆盖 Worker 运行时 `PUBLIC_*` 变量，并用 `--preview-alias`（由分支名派生）发布 **不承接生产流量** 的 Worker 版本。

预览 URL 形如 `https://<alias>-tcitry-blog.<subdomain>.workers.dev`。Workers Builds 也会在 PR 上评论 Version URL。

## AI Search binding

`wrangler.jsonc` 中的 `ai_search` binding（`BLOG_SEARCH` → `tcitry-blog-search`）会随版本上传保留，但当前 `worker/index.ts` **未使用** 该 binding（仅服务静态 `ASSETS`）。匿名搜索走 Pagefind；登录后对话走 staging Convex 配置的 `AI_SEARCH_PUBLIC_URL`。

因此预览继承的是对生产 AI Search 实例的 **只读** binding 配置，但预览部署 **从不** 运行 `sync-ai-search.mjs`。若未来 Worker 代码开始使用 `BLOG_SEARCH`，需要重新评估是否应为预览使用独立实例或移除 binding。

## 所有者手动配置清单

按顺序完成以下步骤（与 Cloudflare Dashboard 中的 Workers Builds 设置一致）：

### 1. 共享 staging Convex

1. 在 Convex Dashboard 创建或选定一个 **非生产** deployment（不是 `hushed-mallard-700`），供所有 PR 预览共用。
2. 为该 deployment 生成 **deploy key**（`dev:…` 格式），记下 deployment URL（`https://<name>.convex.cloud`）。

### 2. Staging Convex 环境变量

在 staging deployment 的 Convex Dashboard → Settings → Environment Variables 中配置（与本地 development 同类，但使用 staging 专用值）：

- `CLERK_FRONTEND_API_URL` — Clerk **development** 实例的 Frontend API URL（与 `pk_test_` 匹配）
- `CLERK_PRO_PLAN_SLUG` — development Billing plan slug（若需验收 Pro）
- `CONSULTATION_ADMIN_TOKEN_IDENTIFIER` — development 咨询作者 identity（若需验收咨询）
- `AI_SEARCH_PUBLIC_URL` — 与 `PREVIEW_AI_SEARCH_PUBLIC_URL` 相同的 AI Search public endpoint（origin 或 `/search`）
- `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` — Workers AI（助手对话），若 staging 需要真实生成
- Resend 等邮件变量 — 仅当需要在 staging 发送邮件时配置

`deploy:preview` 会校验 `CLERK_FRONTEND_API_URL` 与 `AI_SEARCH_PUBLIC_URL` 是否与构建侧封存配置一致；不会自动写入这些变量。

### 3. Clerk development 实例

1. 使用现有 Clerk **development** 实例（`pk_test_` publishable key）。
2. 在 Clerk Dashboard 允许的来源中加入 `https://*.workers.dev`（以及需要的 preview 域名模式）。
3. 保留 Google、邮箱等既有登录方式；仅 GitHub 保持禁用。

### 4. Cloudflare Workers Builds

在 Worker `tcitry-blog` → **Settings** → **Builds**：

1. 启用 **non-production branch builds**（非 `main` 分支构建）。
2. 生产分支（`main`）保持：
   - Build command: `npm run build:workers`
   - Deploy command: `npm run deploy:verified`
3. 非生产分支设置：
   - Build command: `npm run build:preview`
   - Deploy command: `npm run deploy:preview`

### 5. Workers Builds 变量与密钥

生产与非生产构建 **共享** 同一组 Build variables / secrets。预览专用值使用 `PREVIEW_*` 前缀，避免与 `wrangler.jsonc` 中的生产 `PUBLIC_*` 混淆。

**Build variables（非密钥）**

| 变量 | 说明 |
| --- | --- |
| `BLOG_CONTENT_REPOSITORY` | 私有 Blog 仓库 `owner/repo` |
| `SKIP_DEPENDENCY_INSTALL` | 固定为 `1` |
| `PREVIEW_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk development `pk_test_` key |
| `PREVIEW_PUBLIC_CONVEX_URL` | 共享 staging Convex URL（非 `hushed-mallard-700`） |
| `PREVIEW_AI_SEARCH_PUBLIC_URL` | staging 构建与 Convex 共用的 AI Search public endpoint |

**Build secrets**

| Secret | 说明 |
| --- | --- |
| `BLOG_READ_TOKEN` | 克隆私有 Blog 内容 |
| `HEROUI_AUTH_TOKEN` | HeroUI Pro 安装 |
| `PREVIEW_CONVEX_DEPLOY_KEY` | staging Convex deploy key（`dev:…`，非 `prod:`） |
| `CONVEX_DEPLOY_KEY` | 生产 deploy key（仅 `main` 部署使用） |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | 仅生产 `deploy:verified` 的 AI Search 同步需要 |

生产构建仍使用 `PUBLIC_CLERK_PUBLISHABLE_KEY`、`PUBLIC_CONVEX_URL`、`AI_SEARCH_PUBLIC_URL`（可与 `wrangler.jsonc` vars 一致或由 Dashboard 覆盖）。

### 6. 验证

1. 向非 `main` 分支 push，确认 Workers Builds 使用 `build:preview` / `deploy:preview` 成功。
2. 打开 PR 评论中的 preview URL，确认页面为 noindex，Clerk 登录走 development，Convex 数据写入 staging。
3. 确认未触发 AI Search 文章同步，生产站点与 `hushed-mallard-700` 无变化。
