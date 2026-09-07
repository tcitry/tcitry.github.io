# Astro 持续部署方案

2026-09-07 决策建议：使用 **GitHub Actions 构建和校验，Wrangler 发布到 Cloudflare Workers Static Assets**。Workers Builds 同样可行，下面保留其接入条件；应用构建和部署命令不绑定 CI 平台。

本文是后续 CD 接入方案，尚未启用自动部署。当前 `astro` 推送只运行公开主题打包 CI；预览站由已验收的本地构建通过 Wrangler 发布。现有 Hugo 生产工作流继续保留到生产切换。

## 为什么推荐 GitHub Actions

站点由三个来源组成：公开站点代码、固定提交的公开主题、独立私有 Blog 内容。当前 Blog 更新已经通过 `blog-content-updated` 通知站点仓库；已有工作流也处理了私有内容访问和完整历史检出。在此基础上替换构建和发布步骤，改动更少，也能集中执行 URL、评论、收录策略等迁移检查。

GitHub Actions 只负责构建任务，最终静态文件由 Cloudflare 托管；迁移完成后，博客不再使用 Hugo、Go 或 `deploy-pages`。Cloudflare 官方支持这种 [GitHub Actions + Wrangler](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) 部署方式。

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

## GitHub Actions 接入步骤

- 预览先接 `push: astro`，配置 HeroUI Pro 与 Cloudflare CI secrets 后运行完整安装、构建、校验和部署。`workflow_dispatch` 的入口文件需要存在于默认分支；当前只有 `astro` 上的新工作流不能被描述为已经支持手动入口。
- 内容变化继续使用现有 `blog-content-updated`。但 `repository_dispatch` 只从默认分支上的工作流触发；仅在 `astro` 新增文件不会接到当前内容更新事件。预览阶段若需自动跟随内容，要在默认分支增加显式检出 `astro` 的桥接任务，或调整 Blog 的通知方式。这两处本轮尚未修改。规则见 [GitHub 工作流触发文档](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#repository_dispatch)。
- 最终推广到默认分支时，把内容通知接收任务改为 Astro 构建，替换 Hugo/Pages 部署步骤；保持预览独立。生产部署前增加允许收录、robots、canonical、统计策略的正向检查，不能只依赖当前 preview 检查。

当前仓库已有内容访问所需的 secret 名称；尚未配置 HeroUI Pro 和 Cloudflare CI token。因此现有公开主题 CI 成功，不等于完整博客 CD 已接通。

## 如果改用 Workers Builds

Workers Builds 支持连接 GitHub、分支控制和自定义构建/部署命令，满足静态 Astro 部署需求。接入时使用两个独立 Worker：预览 Worker 的主构建分支选 `astro`，生产 Worker 以后选最终默认分支。这里的“production branch”是每个 Worker 自己的主部署分支；预览 Worker 仍然只绑定 preview 域名。

不要把生产 Worker 的普通分支构建直接当作固定 preview 域名部署：其默认命令是 `wrangler versions upload`，上传预览版本，并不替换活动部署。见 [分支控制](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/) 和 [构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)。

具体需要补齐：

- 设置构建变量 `SKIP_DEPENDENCY_INSTALL=1`，通过自定义构建命令运行项目 `setup`；否则平台在主题 tarball 生成前自动安装依赖会失败。设置 `NODE_VERSION=24`，并配置构建阶段的内容访问和 Pro secrets。见 [构建镜像与依赖安装](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)。
- 在构建命令前增加私有 Blog 的完整历史检出步骤，保持现有私有元数据日志处理；连接公开站点仓库并不会自动提供另一个私有仓库的访问能力。
- 预览部署命令明确设置为 `npx wrangler deploy --config wrangler.preview.jsonc`；控制台 Worker 名称与配置一致。
- Blog 单独更新不会触发只连接站点代码仓库的构建。需要从 Blog 通知工作流调用对应分支的 [Deploy Hook](https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/)。Hook URL 本身就是凭据，应保存为 secret；这会额外保留一个小型通知工作流。
- 如果改由 Workers Builds 负责 CD，GitHub Actions 可以继续保留公开主题检查，但不同时向相同 Worker 自动部署。

这些差异是本项目选择 GitHub Actions 的主要依据；后续需要把构建日志和发布管理集中到 Cloudflare 时，可复用相同构建命令切换。
