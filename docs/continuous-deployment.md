# 构建与发布

`tcitry-blog` 通过 Cloudflare Workers Static Assets 发布，生产 Worker 名为 `tcitry-blog`。`main` 是唯一生产分支；命令定义以 `package.json` 为准。

## 环境与分支

- 站点 `main`：生产入口，push 会触发 Workers Builds。
- `astro`：迁移历史和本地核对，不对应远端环境。
- `master` / `hugo-book`：迁移前 Hugo 备份，不参与当前发布。
- Blog 内容仓库 `main`：独立更新，通过通知触发站点云端构建。

只有一个 Wrangler 环境和一个生产 Worker。`PUBLIC_SITE_ENV=production` 控制产物收录策略，不代表第二个 Cloudflare 环境。`www.yindongliang.com` 的 301 跳转由 Cloudflare Redirect Rule 维护，不需要额外 Worker。

## 配置位置

| 位置 | 配置 | 用途 |
| --- | --- | --- |
| `.env.local` | `PUBLIC_CLERK_PUBLISHABLE_KEY`、`PUBLIC_CONVEX_URL`、`AI_SEARCH_PUBLIC_URL` | 本地 development |
| `.env.production.local` | 同名公开变量 | 手动生产构建的本地覆盖 |
| Cloudflare Build variables | 三项 `PUBLIC_*` | 云端生产构建 |
| Cloudflare Build secrets | `CONVEX_DEPLOY_KEY`、同步或发布所需 secret | 云端部署步骤 |
| Convex development / production | `CLERK_FRONTEND_API_URL`、`AI_SEARCH_PUBLIC_URL` 及业务变量 | 对应后端环境 |
| GitHub Actions secret | `CLOUDFLARE_DEPLOY_HOOK` | Blog 内容更新通知 |

规则：

- Clerk 和 Convex 的 development / production 必须分别配置。
- 前端 `AI_SEARCH_PUBLIC_URL` 与对应 Convex `AI_SEARCH_PUBLIC_URL` 必须指向同一 AI Search public endpoint hostname。
- Clerk 启用 Convex integration；Convex `auth.config.ts` 校验 audience `convex`。
- Secret、Deploy Key、API token 和真实 endpoint 不进入 Git；模板只维护 `.env.example`。
- 本地 env 不会自动更新 Cloudflare 或 Convex Dashboard。

账户与权限变量见 [账户服务](member-services.md)，AI Search 同步凭据见 [AI Search](ai-search.md)。

## 本地 review

```sh
npm run setup
npm run check:local
```

普通 `build` 是 noindex 预览，不得发布到生产域名。需要核对页面时运行 `npm run preview` 和相应浏览器测试；具体检查项见 [本地验收](astro-preview.md)。

推送 `main` 前必须完成：

1. 人工 review diff，并运行 `npm run check:public`。
2. 使用真实 development Clerk/Convex 验收登录、账户隔离和权限负向场景。
3. 验证 AI Search 匿名搜索、登录后 AI 对话、引用过滤及失败恢复。
4. 运行项目 check、test、production build 和 release verify。
5. 确认 production 平台变量已配置且与本次构建一致。

Clerk、Convex 和前端发布不具备跨平台原子性。Schema 或 API 变更必须兼容仍在线的前端，并在发布后立即核验真实链路。

## 手动生产发布

生产发布必须在独立、干净的检出中进行，使用独立依赖、缓存和 `dist/`，并固定已经审查的 Blog 内容提交。

```sh
npm run build:production
npm run verify:release
npm run deploy:verified
```

职责边界：

- `build:production` 生成允许收录的生产产物。
- `verify:release` 校验来源提交、配置、产物和 AI Search 语料并封存 release。
- `deploy:verified` 只上传该封存产物，完成线上核验后同步 AI Search。

封存后不得重建或修改 `dist/`、配置、引用清单或语料。Wrangler 上传期间如有其他进程可能改写产物，应中止并从新的独立检出重建。

若站点已上传但线上核验或 AI Search 同步失败，在同一封存目录修复外部条件后运行项目定义的 deployment verify 和同步命令；不要手工制造 deployment receipt。

Workers Builds 的 GitHub check 对应整段 `deploy:verified`：Worker 上传、线上页面核验和 AI Search 同步必须都成功。因此 `/blog-release.json` 的 `siteCommit` 可能已经前进，但 check 仍为失败——这表示语料同步未完成，而不是站点未发布。一条 queued/running 的文章不得阻塞其余新增或更新；该篇重试后仍未完成，check 才保持失败。

## Workers Builds

Workers Builds 仅构建站点仓库 `main`。`build:workers` 会：

1. 获取 Blog 远端 `main` 并解析为固定提交；
2. 在隔离目录安装准确依赖；
3. 部署对应 Convex production functions；
4. 构建并验证生产站点；
5. 交给 Cloudflare 上传已经封存的产物。

`deploy:verified` 随后核验线上站点并同步 AI Search。公开主题 CI、GitHub Actions 通知成功或 `blog-release.json` 已切换都不等于这次 Workers Builds check 已经成功。日常不维护 `BLOG_CONTENT_COMMIT`；它只用于回滚或复现。

## Blog 内容更新触发

Blog 仓库发送 `blog-content-updated` repository dispatch。站点 `.github/workflows/content-update.yml` 接收后调用 `CLOUDFLARE_DEPLOY_HOOK`，请求 Workers Builds 从最新 Blog `main` 重新构建。

通知不携带私有内容或凭据，也不把通知中的 SHA 当作构建输入。Deploy Hook 只需配置一次；变更 hook 或工作流后要用一次真实内容更新验证完整链路。

## 发布后核验

- 主域关键页面、历史 URL、404、RSS、sitemap、robots 和 release marker 正确。
- 普通构建未误发，生产页面允许预期的索引策略。
- Clerk 登录、Convex 私人数据隔离、评论、收藏、咨询和通知使用 production 环境。
- AI Search `/search` 与 Convex `/chat/completions` 使用同一 production public endpoint，引用匹配当前发布语料。
- 已删除的 `/api/chat` 和 `/api/internal/retrieve` 保持 404。
- Cloudflare、Convex 和浏览器日志中没有凭据、私人正文或跨账户数据。
