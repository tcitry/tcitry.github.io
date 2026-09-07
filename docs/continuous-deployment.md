# Astro 持续部署方案

本站采用 **Cloudflare Workers Static Assets** 托管静态博客，优先接入 **Workers Builds 构建、校验并通过 Wrangler 发布**。GitHub Actions 保留为公开主题检查及备用 CD 平台，构建命令与托管平台分离。

2026-09-07：生产切换已获确认，生产配置与校验入口已准备；正式域名部署及默认分支切换以本次发布结果为准。Workers Builds 的 Git 集成、构建 secrets 和内容 Deploy Hook 尚未配置完成。当前发布通过显式 Wrangler 命令执行，公开主题 CI 成功不代表博客自动 CD 已启用。

## 分支与环境

| 项目 | 生产 | 固定预览 |
| --- | --- | --- |
| 站点代码分支 | `main`，生产切换后的默认分支 | `astro` |
| Worker | `tcitry-blog` | `tcitry-astro-preview` |
| 域名 | `yindongliang.com` | `preview.yindongliang.com` |
| Wrangler 配置 | `wrangler.production.jsonc` | `wrangler.preview.jsonc` |
| `PUBLIC_SITE_ENV` | `production`，必须显式设置 | `preview`，也是未设置时的默认值 |
| 本地构建 / 验证 | `npm run build:production` / `npm run verify:production` | `npm run build` / `npm run verify` |
| 本地构建、验证并发布 | `npm run deploy:production` | `npm run deploy:preview` |
| 收录与统计 | 允许收录，检查生产 canonical、robots 与统计 | noindex、禁止抓取、关闭生产统计；canonical 仍指向主站 |

旧默认分支实际名为 `master`，保留为历史 Hugo 分支。远端 `hugo-book` 备份 `ce25b344d48e561f6420f727f43509c4f478e8d9` 包含旧生产提交 `d02f8b83854f7eff39b32b00c1d585d4f3567d7c` 和之后已提交的 Hugo 工作。备份不包含其他工作区的未提交文件或独立 Blog 仓库的内容。

后续在 `astro` 验证，通过后合并到 `main` 发布生产。两个环境使用独立 Worker、配置和构建任务；同一环境只启用一条自动发布流水线。其他分支及 PR 默认只检查，需要时另建临时预览，不覆盖固定域名。站点主题 CI 覆盖 `main` 和 `astro`，只检查公开主题来源、打包与 lockfile，不获取私有 Blog 或商业组件。

`astro-book` 独立主题的 GitHub Pages 文档站单独维护，不参与博客 CD。

## 本地生产发布与首次切换

首次检出先运行 `npm run setup`，准备固定主题包并安装锁定依赖。HeroUI Pro 安装需要已有授权登录或 `HEROUI_AUTH_TOKEN`。生产构建及验收：

```sh
BLOG_DIR=/path/to/Blog npm run build:production
npm run check
npm test
npm run verify:production
```

通过后发布这份已验证的生产 `dist/`：

```sh
npx wrangler whoami
npx wrangler deploy --config wrangler.production.jsonc
```

日常本地发布也可使用 `BLOG_DIR=/path/to/Blog npm run deploy:production`，它会重新构建、验证并部署。预览使用 `deploy:preview`。`PUBLIC_SITE_ENV` 决定产物中的收录与统计策略，Wrangler 配置只决定部署目标；发布时必须让两者匹配。

`www.yindongliang.com` 原来依赖 GitHub Pages 跳转到主域，生产切换会用独立的 `tcitry-www-redirect` 纯静态站点接管。它通过 `hosting/www/_redirects` 的 301 规则保留路径与查询参数，没有后端业务代码，也不开放 workers.dev 地址。首次切换部署一次：

```sh
npx wrangler deploy --config wrangler.www.jsonc
```

日常主站 CD 无需重发这项稳定规则。首次发布后检查主域的 HTTPS、首页、Archives、旧文章 URL、Giscus、robots 和 sitemap，并验证 `https://www.yindongliang.com/archives/?source=cutover` 返回 301 到主域的相同路径与查询参数，再处理 GitHub Pages 解绑。

### GitHub Pages 自定义域名解绑

这一步由仓库所有者在 GitHub 手动执行。先确认生产主域与 www 跳转均已由 Cloudflare 正常响应：

1. 打开 `tcitry/tcitry.github.io` 仓库，进入 **Settings → Pages**。
2. 在 **Custom domain** 区域找到 `yindongliang.com`，点击 **Remove**，完成 GitHub 的确认操作。
3. 刷新页面，确认 Custom domain 已清空；再次访问生产主域和 www 跳转，确认路径与 HTTPS 正常。

生产切换同时停用旧 Hugo Pages 部署工作流，并从 Astro 分支移除 `.github/workflows/pages.yml`。旧 `master` 的源码继续保留；停用自动发布和清除 Pages 自定义域名是两个独立步骤。主题文档站的原生 GitHub Pages 域名可在解绑后单独验收。

## 为什么使用 Workers Builds

Workers Builds 将构建日志、分支发布和部署管理集中在 Cloudflare。当前免费计划包含每月 3,000 分钟构建时间、1 个并发构建，单次构建最长 20 分钟。首次接入应实测全新云端构建耗时，再判断额度是否足够。见[官方额度与限制](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)。

站点构建依赖公开站点代码、固定提交的公开主题、独立私有 Blog 内容和 HeroUI Pro 授权。仓库内的 `build:workers` 入口已负责这些准备步骤；私有内容变化通过 Deploy Hook 触发，不需要新增通知后端。

## Workers Builds 接入步骤

### 首次控制台配置

在 Cloudflare 的 **Workers & Pages → 对应 Worker → Settings → Builds** 中分别连接站点 Git 仓库。首次 GitHub App 授权由账户所有者确认，仅选择需要的站点仓库。生产和预览分别填写下表，不另建 Pages 项目。

| 控制台字段 | 生产 Worker | 预览 Worker |
| --- | --- | --- |
| Worker | `tcitry-blog` | `tcitry-astro-preview` |
| Git repository | `tcitry/tcitry.github.io` | `tcitry/tcitry.github.io` |
| Production branch | `main` | `astro` |
| Root directory | 仓库根目录 `/` | 仓库根目录 `/` |
| Build command | `npm run build:workers` | `npm run build:workers` |
| Deploy command | `npx wrangler deploy --config wrangler.production.jsonc` | `npx wrangler deploy --config wrangler.preview.jsonc` |
| Builds for non-production branches | 首次关闭 | 首次关闭 |

这里的 **Production branch** 指每个 Worker 自己的主构建分支；预览 Worker 选择 `astro` 仍然只部署预览域名。

在各 Worker 的 **Build variables and secrets** 中分别配置以下值。它们属于构建阶段，不是运行时 Variables & Secrets：

| 名称 | 类型 | 生产值 | 预览值 |
| --- | --- | --- | --- |
| `SKIP_DEPENDENCY_INSTALL` | Text | `1` | `1` |
| `NODE_VERSION` | Text | `24` | `24` |
| `PUBLIC_SITE_ENV` | Text | `production` | `preview` |
| `BLOG_CONTENT_REPOSITORY` | Secret | 私有内容仓库的 `owner/repo`，不带 URL | 相同内容仓库 |
| `BLOG_READ_TOKEN` | Secret | 仅有该内容仓库 Contents 读取权限的 GitHub token | 配置同等只读权限 |
| `HEROUI_AUTH_TOKEN` | Secret | HeroUI Pro 的 CI/CD Token | 配置同等授权 |

`SKIP_DEPENDENCY_INSTALL=1` 让项目先生成固定主题 tarball，再安装 lockfile 依赖；空环境直接 `npm ci` 会因主题包尚未生成而失败。使用项目声明的 npm 版本。见[构建镜像与依赖安装](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)。

HeroUI 应使用 Dashboard → Overview / Settings 中的 **CI/CD Token**，不能用个人编辑器/MCP 的 Personal Token 代替；见 [HeroUI Pro 自动安装](https://heroui.pro/docs/react/getting-started/installation)。GitHub Actions secret 无法读回明文，需要使用你保留的值或新建受限凭据。Token 不应发到聊天、写入 Git 或放进 `PUBLIC_*` 变量。

Workers Builds 使用平台配置的部署 token，按首次连接提示完成对应 Worker 的部署授权；云端构建不依赖本地 Wrangler 登录。私有内容检出、`.generated` 和安装后的商业组件均不应上传为公开构建附件。

`build:workers` 会校验环境，检出私有 Blog 的完整 `main` 历史，然后执行 `setup → build → check → test → verify`，把选定的 `PUBLIC_SITE_ENV` 贯穿所有步骤。内容凭据只传给 Git，Pro 凭据只传给安装步骤；成功或失败后均清理临时内容。完整 Git 历史用于生成正确的 lastmod 和排序。

入口支持 `preview` 与显式 `production`，缺省为 `preview`，其他值会失败。它只构建和验证，随后由控制台的 Deploy command 发布同一份 `dist/`。缺少必要 secrets 会在安装前失败。已有离线测试覆盖环境选择、命令顺序、凭据隔离、失败中止和清理；真实云端构建仍须在接线后单独验收。

先让预览 Worker 完成一次全新云端构建并检查固定预览域名，再为生产 Worker 配置同样的入口和对应环境值。记录构建耗时、使用的站点/内容提交及部署结果。生产 Wrangler 首次发布可以先完成，Workers Builds 后续接管日常 CD，两者不必同时启用。

### 构建与内容触发

Git 集成接通后，站点 `astro` / `main` 推送分别触发对应 Worker。不要将生产 Worker 的普通分支构建当作固定预览站：其默认命令 `wrangler versions upload` 上传版本，不会替换活动部署。见[分支控制](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)和[构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)。

Blog 独立仓库更新不会自动触发只连接站点代码仓库的构建。分别创建目标分支的 [Deploy Hook](https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/)，将 Hook URL 保存为 Blog 通知工作流的 secret，再按内容发布策略调用生产或预览 Hook。这部分尚未接通。Hook URL 本身就是凭据，不应写入公开日志或提交。

主题仓库推送也不会隐式升级博客：更新站点的 `astro-book.source.json` 与 lockfile 后，由站点提交触发构建。Workers Builds 负责 CD 后，GitHub Actions 可继续保留公开主题检查和内容更新通知；同一 Worker 不同时启用两套自动部署。

## 备用方案：GitHub Actions

若 Workers Builds 的实测耗时、额度或平台能力不满足需要，可以将同样的构建和验证步骤迁移到 GitHub Actions。官方支持 [GitHub Actions + Wrangler](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) 部署。

- 生产接 `push: main`，预览接 `push: astro`，使用相应 `PUBLIC_SITE_ENV` 和 Wrangler 配置；完整博客构建另需内容读取、HeroUI Pro 及 Cloudflare CI secrets。
- 使用 `CLOUDFLARE_API_TOKEN` 提供 CI 部署权限，不依赖开发机的交互式登录；账户配置已保存在对应 Wrangler 文件中。
- `workflow_dispatch` 和 `repository_dispatch` 的接收工作流需要存在于默认分支。内容更新可复用 `blog-content-updated`，但必须将接收任务明确改为 Astro 构建；旧 Hugo Pages 工作流停用后不会自动接续。见 [GitHub 工作流触发文档](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#repository_dispatch)。

这些是备用方案的接入要求，本次没有增加完整博客 Actions CD。公开主题 CI 与博客构建部署分别验收。

## 部署结果通知

Workers Builds 的 GitHub 集成会为提交提供 check run，展示运行中、成功或失败并链接到构建详情；PR 还会收到构建状态评论。见 [GitHub 集成说明](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)。这些能力在 Git 集成接通后提供。GitHub 邮件取决于个人订阅设置，不能把状态检查等同于每次部署成功都会发邮件。

若需要成功、失败均主动推送邮件、飞书、Slack 或其他 Webhook，可以评估 `build.succeeded`、`build.failed`、`build.canceled` 等 [Event Subscriptions](https://developers.cloudflare.com/workers/ci-cd/builds/event-subscriptions/)。官方方式通过 Queue 和消费者发送消息，需要通知目标和授权；当前没有新增通知后端或配置接收地址。

本项目使用 `wrangler deploy`，任务成功意味着构建和活动部署命令均完成。若以后改为 `versions upload`，成功只代表版本上传。通知应注明环境、提交与部署链接，便于区分生产和预览。
