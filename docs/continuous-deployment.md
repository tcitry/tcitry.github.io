# Astro 构建与发布

本站已上线 `yindongliang.com`，GitHub 默认分支为 `main`。博客只使用一个生产 Worker **`tcitry-blog`**，通过 Cloudflare Workers Static Assets 托管静态资源。日常流程是 **本地预览 → review 与验证 → 提交 → 发布已验证产物**。Workers Builds 的构建入口已准备，但远端 Git 连接与受限构建凭据尚未完成，当前发布仍在本地执行。

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
| 固定来源并验证产物 | `BLOG_DIR=/path/to/Blog npm run verify:release` |
| 发布刚验证过的产物 | `npm run deploy:verified` |
| 手动构建、验证并发布 | `BLOG_DIR=/path/to/Blog npm run deploy:production` |

旧默认分支实际名为 `master`，保留为历史 Hugo 分支。远端 `hugo-book` 备份 `ce25b344d48e561f6420f727f43509c4f478e8d9` 包含旧生产提交 `d02f8b83854f7eff39b32b00c1d585d4f3567d7c` 和之后已提交的 Hugo 工作。备份不包含其他工作区的未提交文件或独立 Blog 仓库的内容。

主题 CI 覆盖 `main` 和 `astro`，只检查公开主题来源、打包与 lockfile，不获取私有 Blog 或商业组件。`astro-book` 独立主题的 GitHub Pages 文档站单独维护，不参与博客发布。站点、Blog 和主题仓库推送均不会自动触发博客部署。

### 2026-09-07 自动发布链路核查

本次同时核对了 GitHub 远端工作流、运行记录和已登录的 Cloudflare 控制台，时间均为北京时间：

- Blog 的 `Notify public site` 工作流仍监听 `main` push，并发送 `repository_dispatch` 事件 `blog-content-updated`；23:10 的通知运行成功，只表示 GitHub 接收了通知。
- 站点默认分支 `main` 只有 `Astro theme reproducibility` 工作流，没有接收该事件的任务，也没有部署步骤。最后一次由该事件触发的[旧 Hugo 发布运行](https://github.com/tcitry/tcitry.github.io/actions/runs/34105161080)发生于 17:17，分支为 `master`；它的成功不代表当前 Cloudflare Worker 已部署。
- Cloudflare 的 **Workers & Pages → tcitry-blog → Settings → Builds** 中，**Git repository** 仍只显示 **Connect**，尚未连接仓库，Workers Builds 自动发布链路未接通。

2026-09-08 再次核对控制台，Git repository 仍为 Connect，未存在可复用的 Workers Builds 部署 token。连接表单会默认创建可编辑多个 Cloudflare 产品的 token；应改用符合本项目所需权限的部署凭据。构建脚本和发布校验已优化，真实云端构建仍待 Git 连接和 CI 凭据就绪后验收。

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

`verify` 同时检查正文站内链接的页面、下载文件和锚点，并拒绝未解析的 `relref`。文章配套下载通过 `scripts/public-downloads.mjs` 中的显式清单发布；当前仅包含 `scripts/upload-r2-image.py`，不会整体复制 Blog 的工具目录。

## 手动生产发布

在独立的站点检出中，从要发布的 `main` 提交生成生产产物。该检出使用自己的依赖、缓存和 `dist/`；`BLOG_DIR` 指向固定到已审查提交、保留完整 Git 历史的内容检出。不要直接使用其他任务仍可能写入的共享开发目录。

共享目录的另一次预览构建会替换 HTML、Pagefind 索引和收录策略。Wrangler 批量上传期间仍会读取资产文件，因此必须从构建、验收到上传完成始终保持这份 `dist/` 不变。若发现并行改写，应中止上传并核对线上版本，再从独立目录重新构建和验收；已经上传的资源不等于一次生产部署已经完成。

在独立检出中完成 `npm run setup` 后执行：

```sh
BLOG_DIR=/path/to/Blog npm run build:production
BLOG_DIR=/path/to/Blog npm run verify:release
```

生产命令显式设置 `PUBLIC_SITE_ENV=production`，校验允许收录的 robots、canonical 和生产统计。需要检查最终产物时，再运行 `npm run preview -- --port 4321`。若 review 后又修改了代码或内容，应重新构建并运行对应检查。

确认产物后发布这份 `dist/`：

```sh
npm run deploy:verified
```

`verify:release` 要求站点与内容检出都干净，运行生产校验并在忽略目录 `.generated/release.json` 记录站点、内容、主题版本和产物哈希。`deploy:verified` 复核站点、配置和每个产物的哈希，再执行一次 Wrangler；不重复构建。它可以在云端内容临时目录已清理后运行。记录文件不含私有仓库 URL、绝对路径或凭据。

便捷命令 `BLOG_DIR=/path/to/Blog npm run deploy:production` 会构建一次、验证并发布；它不会代替此前的 review、`check` 和 tests。Wrangler 仍扫描全部产物，但通过哈希复用已上传文件，只传输新增或变化的资源。

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

## Workers Builds

目标是由 Cloudflare 构建并上传，减少本地安装和网络上传的等待。继续使用现有 `tcitry-blog`，只从站点 `main` 发布生产。**当前代码已准备，控制台连接与构建凭据待完成，尚未获得真实云端成功记录。**

`npm run build:workers` 校验配置、保留内容 `main` 完整历史，并检出 `BLOG_CONTENT_COMMIT` 指定的已审查提交。随后准备主题和锁定依赖，执行一次生产构建、check、test 与发布校验；只生成产物，不自行上传。生产环境显式设置 `PUBLIC_SITE_ENV=production`。缺少凭据、提交不符或验证失败时中止，成功或失败均清理临时内容。

### 控制台配置

完成凭据准备后，在 **Workers & Pages → tcitry-blog → Settings → Builds** 连接站点仓库：

| 控制台字段 | 值 |
| --- | --- |
| Git repository | `tcitry/tcitry.github.io` |
| Production branch | `main` |
| Root directory | 仓库根目录 `/` |
| Build command | `npm run build:workers` |
| Deploy command | `npm run deploy:verified` |
| Builds for non-production branches | 关闭 |
| Build caching | 开启 |

以下值属于 **Build variables and secrets**，不是 Worker 运行时配置：

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `SKIP_DEPENDENCY_INSTALL` | Text | `1` |
| `NODE_VERSION` | Text | `24` |
| `PUBLIC_SITE_ENV` | Text | `production` |
| `BLOG_CONTENT_REPOSITORY` | Secret | 私有内容仓库的 `owner/repo`，不带 URL |
| `BLOG_CONTENT_COMMIT` | Text | 已审查内容提交的完整 40 位 SHA，必须属于内容 `main` 历史 |
| `BLOG_READ_TOKEN` | Secret | 仅有该内容仓库 Contents 读取权限的 GitHub token |
| `HEROUI_AUTH_TOKEN` | Secret | HeroUI Pro 的 CI/CD Token |

`SKIP_DEPENDENCY_INSTALL=1` 让项目先生成固定主题包，再安装 lockfile 依赖；空环境直接 `npm ci` 会因主题包尚未生成而失败。使用项目声明的 npm 版本。见[构建镜像与依赖安装](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)。

HeroUI 使用 Dashboard → Overview / Settings 中的 **CI/CD Token**；见 [HeroUI Pro 自动安装](https://heroui.pro/docs/react/getting-started/installation)。GitHub Actions secret 无法读回明文，需要使用保留的值或新建受限凭据。Token 不应发到聊天、写入 Git 或放进 `PUBLIC_*` 变量。

内容凭据只传给私有内容 Git 检出，Pro 凭据只传给本站依赖安装；公开主题构建与页面渲染不接收这些凭据，Cloudflare 部署凭据也不传给内容准备和测试子进程。成功或失败后均清理临时内容。Workers Builds 使用平台配置的部署 token，云端构建不依赖本地 Wrangler 登录。私有内容检出、`.generated` 和安装后的商业组件均不应上传为公开构建附件。

连接成功后，站点 `main` push 会触发构建。Blog 内容仓库属于独立来源：内容发布必须先审查并更新 `BLOG_CONTENT_COMMIT`，再触发构建；仅发送 Deploy Hook 而不更新固定提交不会发布新内容。后续可将该步骤接入受控通知工作流，Hook URL 作为 secret 保存，不能写入公开仓库。当前这条内容触发链尚未接通。主题升级继续显式更新 `astro-book.source.json` 和 lockfile。

依赖使用 npm 缓存和 `--prefer-offline`，主题 tarball 仅在缓存存在且来源、实际哈希与锁文件校验通过时复用；Cloudflare 默认缓存范围不包含本站 `.artifacts`。Cloudflare 的[构建缓存](https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/)支持 npm 缓存；不能把忽略目录中的产物记录当成跨构建有效的生产发布凭据。首次启用后记录冷启动与缓存命中两次构建耗时，并检查[官方额度与限制](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)。

## 发布结果与通知

当前手动发布以 Wrangler 输出和线上检查为准。GitHub 公开主题 CI 的成功状态只表示主题检查通过，不表示博客已发布；没有配置自动成功邮件或通知后端。

若以后启用 Workers Builds，其 [GitHub 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)可提供提交 check run 和构建详情链接。邮件取决于 GitHub 个人订阅设置；成功、失败均主动推送到指定渠道还需另行配置通知目标与授权。本项目不为此新增常驻后端。

## 优化顺序

- 已实施：最近更新改为独立 JSON，按需加载并重新验证缓存；列表数据变化不再单独导致所有 HTML 改变。导航结构或全站组件变化仍可能改变大量页面。
- 已实施：锁定主题和 npm 缓存复用、固定内容提交、一次构建后验证并上传同一份产物。
- 待接通：Workers Builds Git 集成、受限 CI 凭据、真实云端构建与发布后验收。
- 后续评估：按需加载完整文档菜单，减少每页重复的侧栏 HTML；为 Archives/Modified 增加适合静态站的分页，保留现有入口和索引能力。当前本地产物抽样中，this-blog 约 278 KB HTML 里侧栏约 248 KB、1,981 个节点；Archives 约 1.24 MB、12,197 个节点（gzip 约 68 KB）。优化重点是手机 DOM 与布局开销，不能直接把未压缩体积当作实际传输流量。具体实现需要保留无 JavaScript 导航与既有锚点。
- 后续评估：周刊封面增加小尺寸、响应式图片变体，列表不再下载原始大图；现有懒加载和比例占位继续保留。
