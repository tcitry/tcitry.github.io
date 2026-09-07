# Astro 构建与发布

本站已上线 `yindongliang.com`，GitHub 默认分支为 `main`。博客只使用一个生产 Worker **`tcitry-blog`**，通过 Cloudflare Workers Static Assets 托管静态资源。日常流程是 **本地预览 → review 与验证 → 提交 → 手动 Wrangler 发布**，当前不启用自动部署。

2026-09-07 的首轮生产 HTTP 验收已检查 23 个页面、34 条跳转和 23 项资源。公开主题 CI 继续运行，但不会构建或发布完整博客。

## 分支与运行方式

| 项目 | 约定 |
| --- | --- |
| 生产及默认分支 | `main` |
| 功能验证分支 | `astro` 保留迁移与验证历史，可用于本地开发 |
| 生产 Worker | `tcitry-blog` |
| 生产域名 | `yindongliang.com` |
| Wrangler 配置 | `wrangler.jsonc` |
| 本地预览 | `npm run preview -- --port 4321`，打开 `http://127.0.0.1:4321` |
| 普通构建 / 验证 | `npm run build` / `npm run verify`，默认本地预览模式 |
| 生产构建 / 验证 | `npm run build:production` / `npm run verify:production` |
| 手动构建、验证并发布 | `npm run deploy:production` |

旧默认分支实际名为 `master`，保留为历史 Hugo 分支。远端 `hugo-book` 备份 `ce25b344d48e561f6420f727f43509c4f478e8d9` 包含旧生产提交 `d02f8b83854f7eff39b32b00c1d585d4f3567d7c` 和之后已提交的 Hugo 工作。备份不包含其他工作区的未提交文件或独立 Blog 仓库的内容。

主题 CI 覆盖 `main` 和 `astro`，只检查公开主题来源、打包与 lockfile，不获取私有 Blog 或商业组件。`astro-book` 独立主题的 GitHub Pages 文档站单独维护，不参与博客发布。站点、Blog 和主题仓库推送均不会自动触发博客部署。

### 2026-09-07 自动发布链路核查

本次同时核对了 GitHub 远端工作流、运行记录和已登录的 Cloudflare 控制台，时间均为北京时间：

- Blog 的 `Notify public site` 工作流仍监听 `main` push，并发送 `repository_dispatch` 事件 `blog-content-updated`；23:10 的通知运行成功，只表示 GitHub 接收了通知。
- 站点默认分支 `main` 只有 `Astro theme reproducibility` 工作流，没有接收该事件的任务，也没有部署步骤。最后一次由该事件触发的[旧 Hugo 发布运行](https://github.com/tcitry/tcitry.github.io/actions/runs/34105161080)发生于 17:17，分支为 `master`；它的成功不代表当前 Cloudflare Worker 已部署。
- Cloudflare 的 **Workers & Pages → tcitry-blog → Settings → Builds** 中，**Git repository** 仍只显示 **Connect**，尚未连接仓库，Workers Builds 自动发布链路未接通。

因此，当前推送 Blog 后仍需按下文手动构建、验证并发布。本次仅核查现状，没有启用自动部署或新增凭据；未来如需恢复，需明确接通后文的 Git 集成、构建配置与内容 Deploy Hook。

## 本地预览与 review

首次检出先运行 `npm run setup`，准备固定提交的主题 tarball，再安装 lockfile 依赖。HeroUI Pro 安装需要已有授权登录或 `HEROUI_AUTH_TOKEN`。内容通过 `BLOG_DIR` 只读导入；内容仓库保留完整 Git 历史，用于正确生成 lastmod 和排序。

```sh
BLOG_DIR=/path/to/Blog npm run build
npm run check
npm test
npm run verify
npm run preview -- --port 4321
```

在 `http://127.0.0.1:4321` 检查页面与交互。开发时也可使用 `BLOG_DIR=/path/to/Blog npm run dev`；Pagefind 搜索需要用完整 build + preview 验收。普通构建默认使用本地预览模式，启用 noindex 并关闭生产统计，canonical 仍指向主站。

review 覆盖本次改动涉及的页面，以及有变化的布局、导航、搜索、代码复制、数学公式、Mermaid、移动菜单与 Giscus。保留旧 URL 基线与评论 pathname term。通过后提交站点改动；若更新了主题，同时提交固定来源与 lockfile，确保其他环境能构建相同版本。

## 手动生产发布

从要发布的 `main` 提交生成生产产物：

```sh
BLOG_DIR=/path/to/Blog npm run build:production
npm run verify:production
```

生产命令显式设置 `PUBLIC_SITE_ENV=production`，校验允许收录的 robots、canonical 和生产统计。需要检查最终产物时，再运行 `npm run preview -- --port 4321`。若 review 后又修改了代码或内容，应重新构建并运行对应检查。

确认产物后发布这份 `dist/`：

```sh
npx wrangler whoami
npx wrangler deploy
```

便捷命令 `BLOG_DIR=/path/to/Blog npm run deploy:production` 会重新构建、验证并发布；它不会代替此前的本地 review、`check` 和 tests。希望发布刚验收过的同一份 `dist/` 时，使用上面的直接 Wrangler 命令。

`PUBLIC_SITE_ENV` 决定产物中的收录与统计策略，Wrangler 配置决定发布目标。生产域名只发布经过 `verify:production` 的产物。发布后记录站点提交、内容提交和 Wrangler 部署结果，并抽查首页、Archives、旧文章 URL、robots、sitemap、静态资源与本次修改的功能。

`www.yindongliang.com` 通过 Cloudflare **Redirect Rule** 301 跳转到主域，保留路径和查询参数，不占用额外 Worker。该域名规则由 Cloudflare 管理，日常博客发布无需重新部署。可以检查 `https://www.yindongliang.com/archives/?source=cutover` 是否跳转到主域的相同路径和查询参数。

控制台规则名为 **Blog www to apex**，匹配 `(http.host eq "www.yindongliang.com")`，动态目标为 `concat("https://yindongliang.com", http.request.uri.path)`，状态码 301，启用 **Preserve query string**。DNS 的 `www` 使用 `A 192.0.2.1` 作为代理占位记录，必须保持 **Proxied**；请求在边缘执行跳转，无需访问这个保留地址。HTTP、HTTPS 和百分号编码路径均已验收。

迁移用的 `tcitry-astro-preview` Worker 与 `preview.yindongliang.com` DNS 绑定已于 2026-09-07 删除。首次生产版本为 `bcbfda80-6292-4b59-80a9-545d1daafc3b`，使用主题来源 `f5066d2f0bd591800dcd7433357a60e77b7b38da`；构建保留全部 1,208 条旧 URL。以后不再创建远端预览环境。

发布后的自动 HTTP 验收入口：

```sh
node scripts/verify-deployment.mjs --env production
```

### GitHub Pages 自定义域名解绑

这一步由仓库所有者在 GitHub 手动执行。先确认生产主域与 www 跳转均已由 Cloudflare 正常响应：

1. 打开 `tcitry/tcitry.github.io` 仓库，进入 **Settings → Pages**。
2. 在 **Custom domain** 区域找到 `yindongliang.com`，点击 **Remove**，完成 GitHub 的确认操作。
3. 刷新页面，确认 Custom domain 已清空；再次访问生产主域和 www 跳转，确认路径与 HTTPS 正常。

旧 Hugo Pages 工作流已停用，生产分支已移除 `.github/workflows/pages.yml`。旧 `master` 的源码继续保留；停用自动发布和清除 Pages 自定义域名是两个独立步骤。主题文档站的原生 GitHub Pages 域名可在解绑后单独验收。

## 未来可选：Workers Builds

**当前不启用此方案。** 只有以后明确决定恢复自动发布时，才连接 Workers Builds 的 Git 集成、配置构建 secrets 和内容 Deploy Hook。届时继续使用现有的 `tcitry-blog`，只从 `main` 发布生产，不增加博客 Worker。

仓库保留 `npm run build:workers` 作为可复用的构建入口。它先校验配置、检出私有 Blog 的完整 `main` 历史，再执行 `setup → build → check → test → verify`；只负责构建和验证，不自行部署。生产使用显式 `PUBLIC_SITE_ENV=production`。已有离线测试覆盖环境选择、命令顺序、凭据隔离、失败中止和临时内容清理；这不代表真实云端构建或自动发布已接通。

### 可选控制台配置

以后启用时，在 **Workers & Pages → tcitry-blog → Settings → Builds** 连接站点仓库：

| 控制台字段 | 值 |
| --- | --- |
| Git repository | `tcitry/tcitry.github.io` |
| Production branch | `main` |
| Root directory | 仓库根目录 `/` |
| Build command | `npm run build:workers` |
| Deploy command | `npx wrangler deploy` |
| Builds for non-production branches | 关闭 |

以下值属于 **Build variables and secrets**，不是 Worker 运行时配置：

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `SKIP_DEPENDENCY_INSTALL` | Text | `1` |
| `NODE_VERSION` | Text | `24` |
| `PUBLIC_SITE_ENV` | Text | `production` |
| `BLOG_CONTENT_REPOSITORY` | Secret | 私有内容仓库的 `owner/repo`，不带 URL |
| `BLOG_READ_TOKEN` | Secret | 仅有该内容仓库 Contents 读取权限的 GitHub token |
| `HEROUI_AUTH_TOKEN` | Secret | HeroUI Pro 的 CI/CD Token |

`SKIP_DEPENDENCY_INSTALL=1` 让项目先生成固定主题包，再安装 lockfile 依赖；空环境直接 `npm ci` 会因主题包尚未生成而失败。使用项目声明的 npm 版本。见[构建镜像与依赖安装](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)。

HeroUI 使用 Dashboard → Overview / Settings 中的 **CI/CD Token**；见 [HeroUI Pro 自动安装](https://heroui.pro/docs/react/getting-started/installation)。GitHub Actions secret 无法读回明文，需要使用保留的值或新建受限凭据。Token 不应发到聊天、写入 Git 或放进 `PUBLIC_*` 变量。

内容凭据只传给 Git，Pro 凭据只传给安装步骤；成功或失败后均清理临时内容。Workers Builds 使用平台配置的部署 token，云端构建不依赖本地 Wrangler 登录。私有内容检出、`.generated` 和安装后的商业组件均不应上传为公开构建附件。

如以后还需要 Blog 独立仓库更新触发发布，再为 `main` 创建 [Deploy Hook](https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/)，将 Hook URL 作为 secret 保存在内容通知工作流中；当前不接入。主题升级仍需显式更新站点的 `astro-book.source.json` 和 lockfile。首次启用时实测完整云端构建耗时，并对照[官方额度与限制](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)确认适用性。

## 发布结果与通知

当前手动发布以 Wrangler 输出和线上检查为准。GitHub 公开主题 CI 的成功状态只表示主题检查通过，不表示博客已发布；没有配置自动成功邮件或通知后端。

若以后启用 Workers Builds，其 [GitHub 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)可提供提交 check run 和构建详情链接。邮件取决于 GitHub 个人订阅设置；成功、失败均主动推送到指定渠道还需另行配置通知目标与授权。本项目不为此新增常驻后端。
