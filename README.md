# LYon's Blog · Astro 验证分支

[生产站](https://yindongliang.com) · [Astro 预览站](https://preview.yindongliang.com) · [Astro-book 演示与文档](https://preview.yindongliang.com/lab/) · [astro-book 主题](https://github.com/tcitry/astro-book)

本站正在从 Hugo + hugo-book 迁移到 Astro + `@tcitry/astro-book`。文章继续静态生成，交互实验按需使用 React、HeroUI、HeroUI Pro、Tailwind CSS v4 和 Svelte。原有 Hugo 文件保留，生产站仍使用 Hugo。

主题 UI 仅使用 Tailwind CSS v4 和必要的 CSS Modules，不接入 React、HeroUI 或 HeroUI Pro。HeroUI 与 HeroUI Pro 是本站的业务依赖；Weekly、Timeline、Portfolio 和交互演示也由本站维护。

## 分支约定

仓库当前默认分支名为 **`master`**，尚无 `main` 分支。

| 分支 | 用途 |
| --- | --- |
| `master` | 现有 Hugo 生产版本；继续由既有 GitHub Pages 工作流部署。 |
| `hugo-book` | Hugo + hugo-book 的可恢复备份，迁移验证期间保留。 |
| `astro` | Astro 接入、功能验收和 Cloudflare 预览阶段的提交。 |

2026-09-07 的 Hugo 备份对应 `64b8fc92d`，保留此前 `hugo-book` 分支历史。它是已提交源码的快照，不包含其他工作区的未提交文件，也不包含独立 Blog 仓库中的内容。

验证完成后再审阅 `astro` 到默认分支的合并，并单独切换生产构建、域名和收录策略。如果以后将默认分支改名为 `main`，同步更新工作流的分支条件。创建或推送 `astro` / `hugo-book` 不会触发现有 Hugo 生产部署。`astro` 的主题 CI 在 Ubuntu 和 macOS 上检查固定来源的主题打包与 lockfile 一致性，不访问 Blog 内容、不安装商业组件、不部署站点。

## 安装与本地验证

使用 Node.js 22.12+、npm 和 Git，本项目使用 Node.js 24 验证。首次检出：

```sh
git clone --branch astro https://github.com/tcitry/tcitry.github.io.git
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

开发模式使用 `BLOG_DIR=/path/to/Blog npm run dev`；Pagefind 搜索的完整验收使用 build + preview。

## 主题开发与功能入口

主题仓库负责通用布局、导航、TOC、文章元数据与列表、Markdown/MDX、KaTeX、Mermaid、搜索界面和 Giscus 组件。主题默认使用 Expressive Code，也提供通用关闭接口供消费者替换代码展示。

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
- [持续部署方案](docs/continuous-deployment.md)：Astro 预览/生产分支、GitHub Actions 与 Workers Builds 的接入条件。
- [主题使用指南（英文）](https://github.com/tcitry/astro-book/blob/main/README.md)：主题安装、公开 API、插槽与样式定制。

验收入口包括 `/tags/`、`/categories/`、`/timeline/`、`/weekly/`、`/portfolio/`、`/links/`、`/lab/` 和 `/lab/agent-replay/`。顶部菜单中的 **Astro-book** 位于 **About** 之后，地址仍是 `/lab/`。侧栏不再显示最近修改列表，`/modified/` 页面继续保留。Giscus 保留原始 pathname 映射。

## Cloudflare 预览

Workers Builds 的构建命令使用 `npm run build:workers`，部署命令使用 `npx wrangler deploy --config wrangler.preview.jsonc`。首次连接需要配置构建变量及私有内容/Pro secrets，具体值和通知方式见 [控制台配置步骤](docs/continuous-deployment.md#首次控制台配置)。自动 CD 尚未接通；下面的命令用于显式本地部署。

```sh
npx wrangler whoami
BLOG_DIR=/path/to/Blog npm run deploy:preview
```

`wrangler.preview.jsonc` 使用 Workers Static Assets 托管 `dist/`，绑定 `preview.yindongliang.com`，没有后端业务代码。预览默认启用 noindex、禁止抓取并停用生产统计；canonical 仍指向生产站。生产切换前，不启用 `PUBLIC_SITE_ENV=production`。
