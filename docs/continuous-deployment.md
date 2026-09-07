# Astro 持续部署方案

2026-09-07 决策建议：优先使用 **Cloudflare Workers Builds 构建、校验并通过 Wrangler 发布到 Workers Static Assets**。GitHub Actions 保留为备用 CD 方案及独立检查工具；应用构建和部署命令不绑定 CI 平台。

仓库已提供可供 Workers Builds 使用的 `npm run build:workers` 入口，自动部署尚未接通。当前 `astro` 推送只运行公开主题打包 CI；预览站由已验收的本地构建通过 Wrangler 发布。现有 Hugo 生产工作流继续保留到生产切换。

## 为什么推荐 Workers Builds

博客最终部署在 Cloudflare，使用 Workers Builds 能把构建日志、分支发布和部署管理集中在同一平台，也符合继续学习 Cloudflare 的方向。当前免费计划包含每月 3,000 分钟构建时间、1 个并发构建，单次构建最长 20 分钟。可以先使用该额度，首次云端验收再记录冷启动构建耗时；本地构建耗时不能代替云端实测。见 [官方额度与限制](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)。

站点由公开站点代码、固定提交的公开主题、独立私有 Blog 内容组成。先前推荐 GitHub Actions，是因为现有工作流已经处理私有内容访问和更新通知，能少改一些配置；这些差异属于一次性接线工作，不是 Workers Builds 的能力限制。私有仓库检出、Pro 授权和完整构建校验都能放到 Workers Builds，内容变化通过 Deploy Hook 触发，不需要维护额外后端。

## 分支与环境

| 代码来源 | 部署目标 | 构建策略 |
| --- | --- | --- |
| `astro` | 现有 `tcitry-astro-preview`，`preview.yindongliang.com` | `PUBLIC_SITE_ENV=preview`，禁止收录和生产统计 |
| 未来默认分支 | 单独的生产 Worker，`yindongliang.com` | `PUBLIC_SITE_ENV=production`，生产域名与收录检查 |
| 其他分支 / PR | 校验；需要时另建临时预览 | 不覆盖固定 preview 或生产站 |

当前默认分支仍是 `master`，不是 `main`。以后如果改名为 `main`，同步更新触发条件。预览和生产使用独立 Worker、部署配置及部署任务，部署命令显式指定配置文件；同一环境只允许一条 CD 流水线自动发布。

`astro-book` 独立主题的 GitHub Pages 文档部署继续单独维护，不参与博客 CD。

## 两个平台共有的构建要求

1. 检出站点代码；将 Blog 检出到独立目录，保留完整 Git 历史，并固定本次构建使用的内容提交。`gitDates()` 读取历史生成 lastmod，浅克隆或源码压缩包会影响日期和排序。
2. 配置 Node.js 24 和项目声明的 npm 版本。通过构建 secret 提供 `HEROUI_AUTH_TOKEN`，然后运行 `npm run setup`。此命令先准备固定主题 tarball，再执行 lockfile 安装；空环境直接 `npm ci` 不可用，也不能跳过 Pro 安装脚本。
3. 设置 `BLOG_DIR` 指向内容检出目录，设置本次目标的 `PUBLIC_SITE_ENV`，贯穿以下构建和校验命令：

```sh
npm run setup
npm run build
npm run check
npm test
npm run verify
```

4. 通过后发布同一份 `dist/`。预览命令已经过实际部署验证：

```sh
npx wrangler deploy --config wrangler.preview.jsonc
```

私有内容访问需要 `BLOG_CONTENT_REPOSITORY` 和仅用于读取内容的 `BLOG_READ_TOKEN`。GitHub Actions 部署配置 `CLOUDFLARE_API_TOKEN` secret，使用 CI 专用授权，不依赖开发机的交互式 Wrangler 登录；账户 ID 已在 Wrangler 配置中。上述凭据均放在平台 secrets；内容仓库、`.generated` 和安装后的商业组件不作为公开构建产物上传。Workers Builds 可使用平台管理的部署 token。

主题保持固定 commit，主题仓库推送不会隐式升级博客；更新 `astro-book.source.json` 和 lockfile 后由站点提交触发构建。

## Workers Builds 接入步骤

### 首次控制台配置

在 Cloudflare 的 **iuv → Workers & Pages → tcitry-astro-preview → Settings → Builds** 中连接现有 Worker 的 Git 仓库。首次连接如果出现 GitHub App 授权，由账户所有者确认，仅选择需要部署的站点仓库。不要为此创建另一个 Pages 项目。

| 控制台字段 | 值 |
| --- | --- |
| Git repository | `tcitry/tcitry.github.io` |
| Production branch | `astro`（仅指这个 preview Worker 的主构建分支） |
| Root directory | 仓库根目录 `/` |
| Build command | `npm run build:workers` |
| Deploy command | `npx wrangler deploy --config wrangler.preview.jsonc` |
| Builds for non-production branches | 首次关闭 |

在 **Build variables and secrets** 设置以下值；它们是构建变量，不是 Worker 运行时的 Variables & Secrets：

| 名称 | 类型 | 值 / 来源 |
| --- | --- | --- |
| `SKIP_DEPENDENCY_INSTALL` | Text | `1`，先生成固定主题包再安装依赖 |
| `NODE_VERSION` | Text | `24` |
| `PUBLIC_SITE_ENV` | Text | `preview` |
| `BLOG_CONTENT_REPOSITORY` | Secret | 现有私有内容仓库的 `owner/repo`，不带 URL |
| `BLOG_READ_TOKEN` | Secret | 有权读取该私有仓库 Contents 的只读 GitHub token |
| `HEROUI_AUTH_TOKEN` | Secret | HeroUI Pro Dashboard → Overview / Settings 中的 **CI/CD Token** |

HeroUI 应使用 CI/CD Token，不能用个人编辑器/MCP 的 Personal Token 代替；详见 [HeroUI Pro 自动安装](https://heroui.pro/docs/react/getting-started/installation)。GitHub 已保存的 Actions secret 无法读回明文，需使用你保留的相同值，或自行配置新的受限凭据。不要把 Token 发到聊天、提交到 Git，或放进 `PUBLIC_*` 变量。

`build:workers` 会先验证配置，获取私有内容的完整 main 历史，然后执行 `setup → build → check → test → verify`；内容读取凭据仅传给 Git，Pro 凭据仅传给安装步骤。它不会自行部署，成功后由控制台的 Deploy command 发布同一份 `dist/`。当前入口只允许 preview，生产推广另行启用。

配置齐全后再启动首次构建，记录总耗时并检查部署后的固定 preview 域名。缺少 secrets 的构建会在安装前明确失败，不会覆盖现有预览。当前已通过离线测试验证命令顺序、凭据隔离、失败中止和临时内容清理，尚未将这项结果表述为真实云端构建成功。

### 构建与内容触发

Workers Builds 支持连接 GitHub、分支控制和自定义构建/部署命令，满足静态 Astro 部署需求。接入时使用两个独立 Worker：预览 Worker 的主构建分支选 `astro`，生产 Worker 以后选最终默认分支。这里的“production branch”是每个 Worker 自己的主部署分支；预览 Worker 仍然只绑定 preview 域名。

不要把生产 Worker 的普通分支构建直接当作固定 preview 域名部署：其默认命令是 `wrangler versions upload`，上传预览版本，并不替换活动部署。见 [分支控制](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/) 和 [构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)。

具体需要补齐：

- 设置构建变量 `SKIP_DEPENDENCY_INSTALL=1`，通过自定义构建命令运行项目 `setup`；否则平台在主题 tarball 生成前自动安装依赖会失败。设置 `NODE_VERSION=24`，并配置构建阶段的内容访问和 Pro secrets。见 [构建镜像与依赖安装](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)。
- 在构建命令前增加私有 Blog 的完整历史检出步骤，保持现有私有元数据日志处理；连接公开站点仓库并不会自动提供另一个私有仓库的访问能力。
- 预览部署命令明确设置为 `npx wrangler deploy --config wrangler.preview.jsonc`；控制台 Worker 名称与配置一致。
- Blog 单独更新不会触发只连接站点代码仓库的构建。需要从 Blog 通知工作流调用对应分支的 [Deploy Hook](https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/)。Hook URL 本身就是凭据，应保存为 secret；这会额外保留一个小型通知工作流。
- Workers Builds 负责 CD，GitHub Actions 可以继续保留公开主题检查和内容更新通知，但不同时向相同 Worker 自动部署。

接入顺序为：连接现有 preview Worker 和 `astro` 分支，配置上述构建变量及 secrets，完成一次全新云端构建并验证固定 preview 域名，再接通 Blog 内容更新的 Deploy Hook。最后才在生产迁移阶段启用独立生产 Worker。生产发布前增加允许收录、robots、canonical、统计策略的正向检查，不能只依赖当前 preview 检查。

## 备用方案：GitHub Actions

只有 Workers Builds 的实测耗时、额度或平台能力不满足需要时，再把相同命令迁移到 GitHub Actions。Cloudflare 官方支持 [GitHub Actions + Wrangler](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) 部署。

- 预览接 `push: astro`，配置 HeroUI Pro 与 Cloudflare CI secrets 后运行完整安装、构建、校验和部署。`workflow_dispatch` 的入口文件需要存在于默认分支；当前只有 `astro` 上的新工作流不能被描述为已经支持手动入口。
- 内容变化可复用现有 `blog-content-updated`。但 `repository_dispatch` 只从默认分支上的工作流触发；仅在 `astro` 新增文件不会接到当前内容更新事件。预览阶段若需自动跟随内容，要在默认分支增加显式检出 `astro` 的桥接任务，或调整 Blog 的通知方式。这两处本轮尚未修改。规则见 [GitHub 工作流触发文档](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#repository_dispatch)。
- 最终推广到默认分支时，把内容通知接收任务改为 Astro 构建，替换 Hugo/Pages 部署步骤；保持预览独立。

当前 GitHub 仓库已有内容访问所需的 secret 名称；尚未配置完整博客自动构建所需的 Pro 和部署授权。Workers Builds 也尚未连接仓库和配置构建 secrets。因此现有公开主题 CI 成功，不等于完整博客 CD 已接通。

## 部署结果通知

Workers Builds 的 GitHub 集成会给提交提供 check run，显示运行中、成功或失败，并链接到 Cloudflare 构建详情；在 PR 中还会发布构建状态评论。这些能力随 Git 集成提供，不需要额外通知 Worker。见 [GitHub 集成说明](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)。GitHub 是否给你发送邮件取决于个人订阅设置，不能把状态检查当作“每次部署成功自动发邮件”。

若要成功、失败都主动推送邮件、飞书、Slack 或其他 Webhook，Cloudflare 提供 `build.succeeded`、`build.failed`、`build.canceled` 等 [Event Subscriptions](https://developers.cloudflare.com/workers/ci-cd/builds/event-subscriptions/)。官方方式通过 Queue 和消费者发送消息，需要通知目的地与对应授权；并非只打开一个默认成功邮件开关。当前没有新增通知后端或配置消息接收地址。

在本项目的部署命令为 `wrangler deploy` 时，成功表示构建和活动部署命令都完成；若以后改用 `versions upload`，其成功只代表预览版本上传。配置通知时应保留这个区别。
