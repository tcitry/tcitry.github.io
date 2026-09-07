# Astro 预览、部署与迁移验收

当前采用 Astro 静态生成、独立的 `@tcitry/astro-book` 主题、React / Svelte islands 与原生 MDX，不依赖 Starlight。预览地址是 [preview.yindongliang.com](https://preview.yindongliang.com)，演示入口是 [Astro-book](https://preview.yindongliang.com/lab/)。线上呈现最近一次部署的产物；本地新提交须重新构建、验收并部署后才会出现。生产站 [yindongliang.com](https://yindongliang.com) 继续使用现有 Hugo 工作流。

当前默认分支为 `master`，`hugo-book` 保存 Hugo 源码备份，`astro` 保存迁移验证提交；尚未改名为 `main`。分支发布约定见 [README](../README.md#分支约定)。

## 本地运行

要求 Git、Node 22.12+；推荐本轮验证使用的 Node 24 与 npm 11.13.0。HeroUI Pro 的公开 npm 安装器还会下载已授权组件；新环境先运行 `npx heroui-pro@1.0.0-beta.12 login` 完成官方 CLI 登录，CI 使用专门的 `HEROUI_AUTH_TOKEN` secret。不要把令牌或下载后的商业组件写入仓库，也不要用 `--ignore-scripts` 跳过 Pro 安装。

```sh
# 干净检出即可运行，不需要预先安装 node_modules 或另行检出主题。
npm run setup
BLOG_DIR="$HOME/Blog" npm run build
npm run check
npm test
npm run verify
npm run preview -- --port 4321
```

打开 http://127.0.0.1:4321/ 。Astro 7 preview 作为后台进程运行，使用 npx astro preview status / logs 查看状态，npx astro preview stop 停止。

开发时用 npm run dev。它会先只读导入 Blog 并复制公开资源；`BLOG_DIR` 默认是当前用户的 `~/Blog`，可显式覆盖。修改 Blog 后重新准备内容或重启 dev。Pagefind 由完整 build 生成，验收搜索请使用 build + preview。

`setup` 仅使用 Node 内置模块启动：读取 `astro-book.source.json` 中的公开仓库和完整 commit，独立检出该提交，按照主题自己的 lockfile 执行 `npm ci`，再通过 `npm pack` 构建主题。打包结果必须匹配本站 lockfile 中的 SHA-512，最后才执行本站 `npm ci`。它不会使用本机碰巧存在的主题源码、跟随远端 main 更新或修改 lockfile。`.artifacts/` 中的临时源码和 tarball 均不入 Git；临时源码在打包后自动清理。

打包脚本保留 npm 生成的 tar 条目，再统一 gzip 为不压缩的存储块并规范平台标记。这样不会因 Node 内含的 zlib 压缩算法版本不同而产生不同的 lockfile 完整性；本地包略大，但不上传、不影响网站资源大小。

只准备主题包时运行 `npm run theme:prepare`，然后可单独运行 `npm ci`。如果 HeroUI Pro 安装因未登录失败，完成登录后重新运行 `npm run setup`。构建内容来自另行准备的 Blog checkout；`BLOG_DIR` 指向它即可，不会修改原文。

## 验收入口

- / 与 /docs/：Book 导航、三栏、移动菜单、文章目录、键盘快捷键。
- /tags/、/categories/、/archives/、/modified/：分类、标签、归档、最近修改。
- /timeline/、/weekly/、/portfolio/、/links/：既有独立页面。
- /lab/：顶部菜单 About 之后的 Astro-book 演示与文档页，MDX 同时运行 React、HeroUI OSS、真实 HeroUI Pro、Tailwind v4、Svelte；包含公式与 Mermaid。
- /lab/agent-replay/：复用同一 React 组件的独立页面，回放预置 Agent 步骤，不调用模型或后端。
- /demos/2026/rounded-timeline/、/demos/2026/cloudflare-product-map/：原有静态 demo。
- /index.xml、/posts/index.xml、/weekly/index.xml、各标签与分类的 index.xml：RSS。

侧栏已移除最近修改列表；`/modified/` 的文章列表与入口继续保留。Giscus 按原有文章类型及 kind=page 注入，维持 pathname 映射、仓库、分类、URL 大小写和编码；目录页不注入。没有修改 GitHub Discussions。

## 内容与样式边界

BLOG_DIR 始终只读。构建层兼容 relref、前言字段、旧 URL、HTML、公式、代码和 Mermaid。路由基线在 scripts/legacy-routes.json，审计生成到 .generated/，不会发布。

现有 Blog 没有 MDX。新增交互文章目前放本站 src/pages/*.mdx，通过 Astro 原生编译；独立页面放 src/pages/，组件放 src/components/。在 Blog 添加 .mdx 会得到明确提示，避免错误地按普通 Markdown 发布。外部 Blog MDX 导入留待下一阶段，示例见 docs/demo-authoring.md。

新 UI 优先 Tailwind，其次 CSS Modules。通用 Book 外观兼容层、图标、公式字体和阅读脚本归主题包所有，本站专属页面与徽标配色的样式留在博客。主题保留 Hugo Book MIT 许可与来源。HeroUI 样式在博客局部加载，不向阅读布局引入全局 Tailwind preflight。

## 两个仓库的协作方式

`astro-book` 独立维护通用布局、导航/TOC、文章元数据与列表、搜索界面、图片查看、Giscus 展示，以及 Markdown/MDX 的 KaTeX、Mermaid 和默认的 Expressive Code。主题提供 `markdown.code: false` 与布局 `code={false}`，允许消费者替换普通代码渲染。主题使用合成示例内容，安装、构建、测试不需要商业组件或账号；组件和 integration 都通过公开包入口使用。

本站保留 Blog 导入、Hugo 兼容、旧 URL、标签/分类关系、排序和分页、RSS/sitemap、站点菜单、SEO 策略、Giscus 参数与资格判断，以及 React/HeroUI/HeroUI Pro/Svelte demo。Weekly、Timeline、Portfolio、Links 的路由、数据、业务组件、展示类型和专用样式也全部留在本站，后续可以独立迭代。HeroUI Pro 是博客自己的依赖，用于普通文章/MDX 的代码块以及交互 demo；主题保持无商业依赖。`src/layouts/BookLayout.astro` 是站点到主题的适配层。

博客关闭普通代码块的 EC 包装及 Astro 静态高亮，完整原文仍在构建 HTML 的 `pre/code` 中。阅读到代码附近后，共享 React root 按帧挂载 Pro CodeBlock，使用现成的高亮与复制按钮；禁用 JavaScript 或组件加载失败时保留可读原文。普通文章只加载 CodeBlock / Button 所需样式。Mermaid 图表仍使用主题的 EC 源复制，所以页面仍包含该部分 EC 资源；普通代码不会出现双框或双复制按钮。此选择增加了阅读代码时的 React、Pro、Motion 与 Shiki 客户端成本，具体策略见 [Demo 编写指南](demo-authoring.md#普通文章与-mdx-代码块)。

`package.json` 和 lockfile 当前锁定 `.artifacts/tcitry-astro-book.tgz`，主题来源锁在 `astro-book.source.json`。主题尚未发布 npm，因此干净检出先运行 `npm run setup`，不要直接运行 `npm ci`。以后发布主题版本时再改为准确的 registry 版本号。

升级公开主题时，先确认主题代码已经推送，把 `astro-book.source.json` 的 `commit` 改为完整的新提交 SHA，然后执行 `npm run theme:sync`。它按新的固定来源构建真实 tarball、重新安装并更新本站 lockfile；运行 build/check/test/verify 后，将来源配置与 lockfile 一起提交。回退时恢复两者后运行 `npm run setup` 即可，不需要保留或提交旧 tarball，也不需要改文章。

联调尚未推送的主题代码时，显式指定本地源码：

```sh
# 先在独立主题仓库安装开发依赖（只需首次或依赖更新时执行）。
npm --prefix "$HOME/code/astro-book" ci
ASTRO_BOOK_DIR="$HOME/code/astro-book" npm run theme:sync
npm run build
npm run check
npm test
npm run verify
```

此模式会使用本地修改并更新 tarball 的 lockfile 完整性，供开发验收；不要把只有本机能构建的 lockfile 提交为验证分支。联调通过后先推送主题、更新本站来源 commit，再不设置 `ASTRO_BOOK_DIR` 执行 `npm run theme:sync`；或不设置该变量直接同步原有固定提交以恢复基线。`npm run setup` 始终使用提交的来源，忽略 `ASTRO_BOOK_DIR`。主题更新会参与 Markdown 缓存指纹，避免同版本本地迭代仍显示旧渲染结果。

首次固定来源安装的历史验证使用没有 `node_modules`、主题源码或预存 tarball 的临时目录：固定主题先构建，再完整安装本站依赖，lockfile 字节保持不变；当时安装的 125 个主题文件与打包产物逐字节一致，主题公开入口、CSS、HeroUI Pro 与 React/Svelte integration 均可解析。本站 Node 24 生成的 lockfile 在该 Node 26 环境也通过校验。此记录对应当时的主题版本，并使用本机现有 HeroUI Pro 授权环境；更换主题提交后仍须重新验证，新的开发机器或 CI 也须配置自己的授权。

既存 Python 语言基础 .md 与 _index.md 路径冲突按 Hugo 实际行为处理：保留目录页，被覆盖正文只记录审计。大小写不同且会在 macOS 文件系统相互覆盖的别名写入 Cloudflare _redirects，不覆盖真实页面。

## Cloudflare 预览部署

wrangler.preview.jsonc 通过 Workers Static Assets 托管 dist/，没有 Worker 业务代码或后端 API。仅绑定 preview.yindongliang.com，不改生产域名。

```sh
# 新机器或授权过期时，先完成浏览器登录；无需启用无关产品权限。
npx wrangler login --scopes account:read user:read workers_scripts:write workers_routes:write zone:read
npx wrangler whoami
npm run deploy:preview
```

Wrangler 在登录时自动加入刷新授权所需的 offline_access，不要将它作为 `--scopes` 参数传入。配置中的账户 ID 对应本次部署账户；更换账户时先核对 `whoami` 并更新 `wrangler.preview.jsonc`。配置的 Custom Domain 由 Cloudflare 管理 DNS 与 TLS。

预览默认禁用收录和生产统计：HTML noindex、robots.txt、Cloudflare X-Robots-Tag；canonical 保留生产域名。PUBLIC_SITE_ENV=production 是未来切换时显式启用的构建开关，本轮不启用。

首次部署版本为 `40735e8f-5301-4b9b-8ac3-a7f32839523e`，Worker 名为 `tcitry-astro-preview`，备用地址为 [tcitry-astro-preview.iuv.workers.dev](https://tcitry-astro-preview.iuv.workers.dev)。旧内容的外链、引用等编辑问题仍按约定留到架构确认以后处理。

## 首次迁移验收记录（历史）

以下保留首次迁移、主题提取和公网发布时的检查结果。后续主题引入 Expressive Code、博客采用 Pro CodeBlock、业务组件迁回博客及侧栏/demo 调整，均须按当前提交重新验收；这里的数字不代表后续提交已通过全量检查。当前机器检查产物位于 `.generated/`，需要核对其生成时间和构建来源。

- 全部 1,208 个原有公开 URL 在新构建中保留；包含旧目录大小写、中文编码与文章 permalink。
- 102 个可见导航分组与受控 Hugo 输出逐组比较，顺序一致。
- CUA 对比首页与同篇 Docs，桌面三栏尺寸一致；390px 宽度下菜单、目录与实验页无横向溢出。
- 搜索、代码复制、Giscus iframe、Timeline 年份切换、59 期 Weekly、13 项 Portfolio，以及 React/Svelte 的真实交互已验收。
- 集中渲染现有 103 个 Mermaid 图表：102 个成功。唯一失败来自 Kubernetes《节点组件详解：角色、职责与交互》的既存 sequenceDiagram；线上 Hugo 同页也会报渲染错误。按本轮不改内容的约定，保留源码并显示降级提示，待内容更新阶段修正。
- LaTeX 保留旧定界符，金额不会跨粗体边界误吞正文；构建产物中没有 KaTeX 错误。

机器检查结果在 .generated/verification.json；内容兼容诊断在 .generated/content-diagnostics.json。原有外链与引用的编辑问题未修改。

## 首次独立主题接入验收（2026-09-07，历史）

- 主题已从独立仓库打成真实 tarball 并安装到本站，没有工作区源码链接或跨仓库深层导入。
- 独立主题构建、完整源码检查和 16 项渲染/样式测试通过。隔离临时消费者通过 tarball 安装主题、通过公开 registry 安装依赖，4 页构建通过，Markdown/MDX 各自包含公式与图表，59 个字体引用均在本地可用；消费者不配置 Tailwind 编译器，也不需要 React 或商业组件授权。
- 本站检查 0 错误/0 警告；10 项兼容与缓存测试通过；依赖审计 0 漏洞。当时构建验证 1,225 个页面路由，保留全部 1,208 个旧 URL，950 个 Giscus 页面、25 个公式页面、65 个 Mermaid 页面、622 个代码页面。
- 与提取前静态副本比较，所有旧 HTML、title、canonical、TOC、分页、周刊、时间线和作品数据保留。导航主体链接顺序、active 和无链接分组控件一致。过程中其它工作向 Blog 增加了一篇文章及引用，因此总数、最近修改窗口和少量上下篇发生相应变化；本任务未编辑 Blog 原文。
- 固定 1280px 视口：首页三栏仍为 320/640/320px，导航字号仍为 14px，首行位置及行距一致。周刊、作品、时间线的内容高度与基线一致；归档旧文章逐行高度一致。标签云原有不换行问题修复，标签/分类页不再产生整页横向滚动。
- 本站 Pagefind 搜索 SwiftUI 返回 261 条；文章复制按钮进入成功状态，Giscus iframe 正常加载。实验页 React/HeroUI Pro 完成 7 帧回放，Svelte 计数与派生值更新，深色下公式和 Mermaid 正常；新增阅读主题选择器可切换系统/浅色/深色。
- 390px 手机视口下两个 demo 各 358px，整页不溢出，导航正常展开。主题独立示例还验证了长公式/宽图/表格局部滚动、图片查看与焦点恢复、多个错误 Mermaid 独立保留源码，以及明暗切换后重新渲染。

当时主题构建有 Mermaid 分块体积提示和旧代码复制兼容回退的弃用提示；后续主题默认代码组件改用 Expressive Code，博客随后选择 Pro CodeBlock。Mermaid 通过动态导入按页面需要加载。这一阶段未进行 Lighthouse 性能测量，主题也未发布 npm。

## 首次 Cloudflare 公网验收（2026-09-07，历史）

- 自定义域名及 workers.dev 备用域名均通过 HTTPS 返回 200。
- 23 项 HTTP 检查通过：首页、实验室、文章、标签/分类、时间线、周刊、作品、友链、RSS、sitemap、搜索脚本、CSS/JS/字体、尾斜线跳转、大小写旧别名和缺失页 404。
- HTML 与响应头保持 noindex，robots.txt 禁止抓取，canonical 指向生产站；带哈希资源使用一年 immutable 缓存。
- 公网浏览器中 React/HeroUI Pro 完成 7 帧回放，Svelte 计数与派生值更新；2 个公式、Mermaid 和深色切换正常。Pagefind 搜索 SwiftUI 返回 261 条。
- 文章底部 Giscus 正常显示表情和评论区，仍在前后页导航之后；实际 widget 的 term 保留原始 pathname，未写入或更改 Discussions。

HTTP 检查记录在 `.generated/cloudflare-verification.json`。Cloudflare 对 Python urllib 默认客户端返回 1010；上述检查使用 curl，并用真实浏览器交叉验证，未调整账户的安全规则。

## 当前集成验收（2026-09-07）

本轮使用公开主题提交 `c9f83e2f8ce43d8d9ab95f64a9b10a8f3dbf9d4f`，未设置 `ASTRO_BOOK_DIR`，从远端固定来源重新打包并同步 lockfile。

- 本站构建 1,226 个页面，完整保留 1,208 个旧 URL；包含 951 个 Giscus 页面、25 个公式页面、65 个 Mermaid 页面、623 个代码页面。Feeds、搜索、既有 demo、MDX/React/Svelte 与预览收录策略检查通过。14 项测试通过；28 个文件的 Astro 检查为 0 错误、0 警告。
- 主题通过 27 项测试和类型检查；独立示例构建 13 页。真实 tarball 的隔离消费者检查通过，包含 Markdown/MDX、公式、图表、搜索与 59 个本地字体资源，不需要 React、HeroUI Pro 或博客内容。
- 博客以 `markdown.code: false` 和布局 `code={false}` 关闭普通 EC 展示，在生成 HTML 前处理代码 AST；MD 与 MDX 使用同一适配。没有先生成 EC 再拆解 HTML，也没有添加 renderer/provider 注册层。主题自己的默认 EC 保留文件名、行号、标记、高亮和复制。
- Lab 中 HeroUI 表单、Pro 消息/步骤/来源/代码复制、回放与暂停，以及 Svelte 状态和派生值均通过浏览器操作验证。普通 MDX 和文章代码的剪贴板内容与完整静态原文一致，保留末尾换行。明暗主题下代码高亮可读，没有双框或双复制按钮。
- 包含 154 个代码块的 Kubectl 页面，顶部稳定后只挂载附近 5 个 Pro 块，向下阅读后增至 10 个，始终共享一个 React root；初始 HTML 保留全部 154 段原文。这里只验证按需挂载行为，未进行 Lighthouse 或 CPU 性能测量。
- 2560px 下侧栏恢复 Hugo 的 max-content、20rem 最小宽度和原有 clamp 最大宽度，左侧起点为 0；Weekly 卡片与封面保持 320px、320×192px，间距 16px。390px 下 Weekly、归档和 Timeline 无整页横向溢出；Doc/ByAI/其他标签横向间距 4px、换行间距 2px。Timeline 年份选择实际跳转到 `/timeline/2025/`。

独立主题文档示例位于 `astro-book` 的 `examples/basic/`，可在主题仓库运行 `npm run build`、`npm run preview -w @astro-book/basic`。本次本地验收地址为 `http://127.0.0.1:4322/astro-book/`，已验证带 base 路径的搜索、移动导航、EC 复制与明暗主题，以及 Mermaid 展示和原始源码复制。

目标公开地址是 `https://tcitry.github.io/astro-book/`，目前尚未发布：GitHub Pages 会继承用户站点当前绑定的 `yindongliang.com`，原生地址实际 301 跳转到该域名。文档工作流已完成构建并上传产物，通过域名检查跳过发布，避免将独立演示站发布到博客域名下。待生产博客完成 Cloudflare 迁移、解除用户 Pages 自定义域名后，再运行主题 Pages 工作流；本轮未更改生产域名。规则见 [GitHub Pages 自定义域名文档](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages)。

本轮预览已部署到 `preview.yindongliang.com`，Cloudflare 版本为 `9bda6e8a-d93a-424d-90e4-e4a9a0ee134f`，对应实现提交 `dc1f7ed7b`。20 项 HTTP 检查通过，包括菜单顺序、旧文章静态代码、Giscus pathname、noindex、robots、RSS/search、404/尾斜线与不可变资源缓存。公网浏览器验证 Pro 组件激活、回放/暂停、完整结果与代码原文复制，未出现控制台错误。该部署仍是显式 Wrangler 发布，自动 CD 的后续安排见 [持续部署方案](continuous-deployment.md)。
