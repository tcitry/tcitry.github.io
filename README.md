# LYon's Blog

[生产站](https://yindongliang.com) · [Astro-book 演示与文档](https://yindongliang.com/lab/) · [astro-book 主题](https://github.com/tcitry/astro-book)

本站使用 Astro + `@tcitry/astro-book`。文章静态生成，交互实验按需使用 React、HeroUI、HeroUI Pro、Tailwind CSS v4 和 Svelte。博客只使用一个 Cloudflare Worker `tcitry-blog` 托管生产静态资源，无需维护独立后端。

2026-09-07：Astro 已上线 `yindongliang.com`，GitHub 默认分支已切换为 `main`。日常在本地预览、review 和验证，通过后手动使用 Wrangler 发布。当前不启用自动部署。

主题 UI 仅使用 Tailwind CSS v4 和必要的 CSS Modules，不接入 React、HeroUI 或 HeroUI Pro。HeroUI 与 HeroUI Pro 是本站的业务依赖；Weekly、Timeline、Portfolio 和交互演示也由本站维护。

## 分支约定

当前默认分支为 `main`；旧默认分支实际名为 `master`。

| 分支 | 用途 |
| --- | --- |
| `main` | Astro 生产及默认分支，本地验收后手动发布到 `yindongliang.com`。 |
| `astro` | 保留迁移和功能验证历史，可用于本地开发验证。 |
| `hugo-book` | Hugo + hugo-book 的可恢复备份。 |
| `master` | 保留的旧 Hugo 分支，不再作为 Astro 部署入口。 |

2026-09-07 的远端 Hugo 备份为 `ce25b344d48e561f6420f727f43509c4f478e8d9`，包含旧生产提交 `d02f8b83854f7eff39b32b00c1d585d4f3567d7c` 和之后已提交的 Hugo 工作。它保留已有分支历史，不包含其他工作区的未提交文件，也不包含独立 Blog 仓库中的内容。

后续修改先在本地 review 和验证，再提交到 `main` 并手动发布。主题 CI 覆盖 `main` 和 `astro`，在 Ubuntu 和 macOS 上检查固定来源的主题打包与 lockfile 一致性，不访问 Blog 内容、不安装商业组件、不部署站点。旧 Hugo Pages 工作流已停用；GitHub Pages 的自定义域名还需按[手动解绑步骤](docs/continuous-deployment.md#github-pages-自定义域名解绑)移除。

## 安装与本地验证

使用 Node.js 22.12+、npm 和 Git，本项目使用 Node.js 24 验证。首次检出：

```sh
git clone --branch main https://github.com/tcitry/tcitry.github.io.git
cd tcitry.github.io
npm run setup
```

`setup` 从公开主题仓库取得锁定的 commit，构建真实主题 tarball，然后依据本站 lockfile 安装依赖。无需预先在某个本机目录检出主题；主题尚未发布 npm，不能跳过准备步骤直接在空环境运行 `npm ci`。HeroUI Pro 需要你已有的合法授权与登录，或环境变量 `HEROUI_AUTH_TOKEN`，令牌不要写入 Git。

主题来源和当前锁定的完整 commit 记录在 `astro-book.source.json`。初始化时会校验打包产物与 lockfile 的完整性，不会自动更新依赖版本。

内容保存在独立 Blog 仓库，构建仅只读导入公开内容。指定本地检出目录后运行：

```sh
BLOG_DIR=/path/to/Blog npm run build
npm run check
npm test
npm run verify
npm run preview -- --port 4321
```

在浏览器打开 `http://127.0.0.1:4321` 进行本地 review。开发模式使用 `BLOG_DIR=/path/to/Blog npm run dev`；Pagefind 搜索的完整验收使用 build + preview。普通 `build` 默认生成本地预览产物，生产使用 `build:production` 和 `verify:production`。

## 主题开发与功能入口

主题仓库负责通用布局、导航、TOC、文章元数据与列表、Markdown/MDX、KaTeX、Mermaid、搜索界面与索引构建，以及 Giscus 组件。主题默认使用 Expressive Code，也提供通用关闭接口供消费者替换代码展示。

Pagefind 依赖和构建流程由 `astro-book` 统一维护；本站不需要单独安装 Pagefind 或运行索引命令。`astro build` 完成静态页面后，主题自动为本站生成 `dist/pagefind/`。本站仅在 `astro.config.mjs` 的 `astroBook({ search: { glob, rootSelector } })` 中配置 `docs/`、`posts/`、`weekly/` 的索引范围及 `main` 正文区域，在 `src/layouts/BookLayout.astro` 中配置中文提示；原有 `pagefind.yml` 已迁入该配置。各网站按自己的内容生成索引，不共享文章数据。普通 `astro dev` 不生成索引，搜索验收使用完整 build + preview。

本站负责内容导入、旧 URL、tag/category、RSS/sitemap、页面排序与数据、站点配置和交互 demo。Weekly、Timeline、Portfolio、Links 的业务组件、展示类型和专用样式也留在本站。本站普通文章与 MDX 的代码块统一使用 HeroUI Pro CodeBlock：先输出完整可读的静态代码，接近视口后加载 React / Pro 高亮与复制；Mermaid 源复制保留主题实现。公开主题没有商业组件依赖。加载策略与成本见 [代码块说明](docs/demo-authoring.md#普通文章与-mdx-代码块)。

主题的旧 Hugo SCSS/Sass 构建层已替换为 Tailwind CSS v4 和 CSS Modules，公开尺寸变量与插槽继续保留。Archives 的年份分类使用当前页锚点；这项博客定制由本站的 `PageToc` 维护。

原 `demos/` 中的圆弧时间线已迁入 `src/components/demos/` 与 `src/pages/demos/2026/`，保留 `/demos/2026/rounded-timeline/`。它随根项目统一构建，不再单独运行 Vite 或向 Blog 写入构建产物。

本地修改独立主题后，可显式同步并重新验收：

```sh
ASTRO_BOOK_DIR=/path/to/astro-book npm run theme:sync
BLOG_DIR=/path/to/Blog npm run build
npm run verify
```

要把主题更新提交到共享分支，先将主题修改提交并推送到独立仓库，更新 `astro-book.source.json`，再不带 `ASTRO_BOOK_DIR` 运行 `npm run theme:sync`。将来源配置与 lockfile 一起提交，避免把仅本机可用的开发包作为固定版本。

- [预览与迁移验收](docs/astro-preview.md)：安装细节、主题升级、URL/评论兼容与已完成的检查。
- [Demo 编写指南](docs/demo-authoring.md)：在 MDX 或独立页面中复用交互组件。
- [构建与发布说明](docs/continuous-deployment.md)：本地 review、单生产 Worker 手动发布，以及未来可选的 Workers Builds。
- [主题使用指南（英文）](https://github.com/tcitry/astro-book/blob/main/README.md)：主题安装、公开 API、插槽与样式定制。

验收入口包括 `/tags/`、`/categories/`、`/timeline/`、`/weekly/`、`/portfolio/`、`/links/`、`/lab/` 和 `/lab/agent-replay/`。顶部菜单中的 **Astro-book** 位于 **About** 之后，地址仍是 `/lab/`。侧栏不再显示最近修改列表，`/modified/` 页面继续保留。Giscus 保留原始 pathname 映射。

## 手动发布到 Cloudflare

生产目标固定为 `tcitry-blog`，配置文件为 `wrangler.production.jsonc`，域名为 `yindongliang.com`。本地 review 完成后生成并验证生产产物：

```sh
BLOG_DIR=/path/to/Blog npm run build:production
npm run verify:production
```

确认生产产物后，发布同一份 `dist/`：

```sh
npx wrangler whoami
npx wrangler deploy --config wrangler.production.jsonc
```

也可使用 `BLOG_DIR=/path/to/Blog npm run deploy:production` 重新构建、验证并发布。生产命令显式使用 `PUBLIC_SITE_ENV=production`，检查可收录的 robots、canonical 和生产统计；本地预览默认 noindex 并停用生产统计。

`www.yindongliang.com` 通过 Cloudflare Redirect Rule 301 跳转到主域，保留路径和查询参数，不需要额外 Worker。Workers Builds 仅作为未来可选方案；若以后启用，只连接 `main` 和现有生产 Worker。当前站点、Blog 或主题仓库推送均不会自动发布博客。
