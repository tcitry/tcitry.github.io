# Astro 本地验收与生产发布

生产站 [yindongliang.com](https://yindongliang.com) 已采用 Astro 静态生成、独立的 `@tcitry/astro-book` 主题、React / Svelte islands 与原生 MDX，不依赖 Starlight。演示与使用文档入口是 [Labs](https://yindongliang.com/labs/)。主站只保留生产 Worker `tcitry-blog`，在本地 review 后直接发布；迁移期间的 `preview.yindongliang.com` 已下线，不再作为验收或发布目标。

当前 `main` 只保留 Astro 入口，命令以 `package.json` 为准。旧 `makefile`、`deploy.sh`、`config.toml`、`go.mod` / `go.sum`、Hugo `layouts/` 与 `assets/`、未使用的 `en/` 示例均已移出当前分支；历史源码保留在 `hugo-book` / `master`。`scripts/legacy-routes.json`、内容兼容层及相关 tests 仍用于保护已发布 URL 与评论映射，不能作为遗留产物删除。

当前生产及默认分支为 `main`；`master`、`hugo-book` 和 `astro` 保留迁移历史，不对应另一套在线预览。分支发布约定见[构建与发布](continuous-deployment.md#分支与运行方式)。

## 本地运行

要求 Git、Node 22.12+；推荐本轮验证使用的 Node 24 与 npm 11.13.0。HeroUI Pro 的公开 npm 安装器还会下载已授权组件；新环境先运行 `npx heroui-pro@1.0.0-beta.12 login` 完成官方 CLI 登录，CI 使用专门的 `HEROUI_AUTH_TOKEN` secret。不要把令牌或下载后的商业组件写入仓库，也不要用 `--ignore-scripts` 跳过 Pro 安装。

```sh
# 干净检出即可运行，不需要预先安装 node_modules 或另行检出主题。
npm run setup
PUBLIC_SITE_ENV=preview BLOG_DIR="$HOME/Blog" npm run build
npm run check
npm test
npm run verify
npm run preview -- --port 4321
```

打开 [本地预览](http://127.0.0.1:4321/)。Astro 7 preview 作为后台进程运行，使用 `npx astro preview status` / `logs` 查看状态，`npx astro preview stop` 停止。本地预览产物保留 noindex、禁止抓取并关闭生产统计；canonical 始终指向生产域名。

可运行 `node scripts/verify-deployment.mjs --env preview` 检查本地页面；默认地址为 `http://127.0.0.1:4321`，其他端口通过 `--origin` 指定。Astro preview 不执行 Cloudflare 的 `_headers`、`_redirects`，本机检查因此跳过平台响应头、HTTP 重定向与 immutable 缓存断言；重定向和响应头配置仍由 `npm run verify` 检查，实际托管行为在生产发布后验收。

开发时用 npm run dev。它会先只读导入 Blog 并复制公开资源；`BLOG_DIR` 默认是当前用户的 `~/Blog`，可显式覆盖。修改 Blog 后重新准备内容或重启 dev。`preview` 只读取已有 `dist/`，不会跟随 Blog 或源码变化，更新后需要重新构建；不要将不同构建的页面、最近更新元数据和 Pagefind 索引混用。Pagefind 由 astro-book 在 Astro 构建完成时自动生成，本站仅配置索引范围，不再单独安装或执行 Pagefind；验收搜索请使用同一次 build + preview。

代码块与图表需要同时验收开发模式：启动 dev 后运行 `node tests/browser/reading.mjs`，检查无 React island 的真实文章中 Pro 代码块、Mermaid SVG 和原文复制。完整浏览器回归使用 build + preview，再设置 `BLOG_TEST_URL` 运行 `npm run test:browser`，同时验收需要生成索引的搜索功能。博客显式初始化 Pro 挂载所需的 React 开发运行时；主题 integration 在 dev 预构建 Mermaid 及其 CommonJS 子依赖。同步主题包后重启开发服务，同一检出不要同时启动多个 dev 进程共享 Vite 缓存。

本站通过主题公开的 `components.Search` 接口替换默认搜索。`BlogSearch.astro` 输出原生入口，首次打开时才加载 HeroUI Pro Command；弹窗挂载后从构建生成的 `/search/recent.json` 获取 6 条最近更新，输入关键词后才加载 Pagefind JavaScript API，按索引排名显示结果并逐批加载摘要。最近更新不再内联到每份 HTML，避免只有更新时间改变时连带改写全部页面；导航目录或公共组件变动仍可能影响全站产物。不再加载默认 Pagefind UI，主题自身仍保持原有默认实现。

最近更新请求使用 `cache: 'no-cache'` 与 HTTP 重验证策略，每次打开均与当前发布版本核对。加载过程不阻塞输入和全文搜索；失败或超时会显示独立重试入口，关闭弹窗取消未完成请求。构建、验收与发布必须让此 JSON、页面和 Pagefind 索引来自同一内容快照。

最近更新来自 `docs`、`posts`、`weekly` 的公开独立内容页，按有效更新时间排序，缺失时回落发布日期；没有发布日期但有更新时间的笔记同样参与。排除草稿、隐藏页、跳转页、空正文和显式 `bookSearchExclude`，只传递标题、URL、日期与内容类型；搜索结果继续使用现有 Pagefind 索引范围。入口与输入框提示统一为 `Search`，无障碍标签保留中文。弹窗支持 ⌘ / Ctrl + K、`/`、`s`、方向键、Enter、Esc、中文输入法、加载更多及失败重试。`tests/browser/search.mjs` 检查真实索引搜索、响应竞态、键盘焦点和移动布局，并逐条请求最近更新的目标页面、断言键盘跳转返回 HTTP 200，避免只检查链接字符串却漏过 404。

Posts 页尾的“相关阅读”由 `src/lib/related-posts.ts` 在构建时从公开文章元数据中选出，`RelatedPosts.astro` 输出静态列表。共同主题标签越多越靠前；重合数量相同时，优先使用频率较低的主题标签，再按发布时间从新到旧排列，避免宽泛标签盖过具体主题。不把 `Recommended`、`ByAI`、`Weekly`、`Links` 状态标签或年份分类当作相关主题。去重后有至少 6 篇候选时显示 6 篇，有 4–5 篇时显示 4 篇，使双列卡片完整成行；不足 4 篇时按实际相关数量展示，无匹配时不显示，不用无关文章补齐。排除自身、重复 URL、草稿、隐藏页和跳转页。旧文章可以推荐后来发布的同主题文章。

该区块位于正文及版权、前后篇导航之后，Giscus 之前，不加入桌面或移动端文章目录。推荐列表不进入 Pagefind 正文索引。`npm test` 检查推荐规则，`npm run test:browser` 同时检查禁用 JavaScript 时的文章链接、目录边界、评论位置及 1440px / 375px / 320px 布局。

相关阅读采用 HeroUI Card / Chip，在 Astro 构建时渲染为静态 HTML，使用原生整卡链接，不额外加载客户端脚本。正文列达到 40rem 时显示两列，小屏单列；标题完整换行，摘要最多两行，展示最多两个共同主题标签和发布日期。摘要优先使用显式 description，否则从正文提取叙述段落，跳过代码、图表、标题和 AI 编辑说明；没有适合段落时省略摘要。

`setup` 仅使用 Node 内置模块启动：读取 `astro-book.source.json` 中的公开仓库和完整 commit，独立检出该提交，按照主题自己的 lockfile 执行 `npm ci`，再通过 `npm pack` 构建主题。打包结果必须匹配本站 lockfile 中的 SHA-512，最后才执行本站 `npm ci`。它不会使用本机碰巧存在的主题源码、跟随远端 main 更新或修改 lockfile。`.artifacts/` 中的临时源码和 tarball 均不入 Git；临时源码在打包后自动清理。

打包脚本保留 npm 生成的 tar 条目，再统一 gzip 为不压缩的存储块并规范平台标记。这样不会因 Node 内含的 zlib 压缩算法版本不同而产生不同的 lockfile 完整性；本地包略大，但不上传、不影响网站资源大小。

只准备主题包时运行 `npm run theme:prepare`，然后可单独运行 `npm ci`。如果 HeroUI Pro 安装因未登录失败，完成登录后重新运行 `npm run setup`。构建内容来自另行准备的 Blog checkout；`BLOG_DIR` 指向它即可，不会修改原文。

## 验收入口

- / 与 /docs/：Book 导航、三栏、移动菜单、文章目录、键盘快捷键。
- /tags/、/categories/、/archives/、/modified/：分类、标签、归档、最近修改。
- /timeline/、/weekly/、/portfolio/、/links/：既有独立页面。
- /labs/：顶部菜单 About 之后的 Labs 前端实验页，MDX 同时运行 React、HeroUI OSS、真实 HeroUI Pro、Tailwind v4、Svelte；包含公式与 Mermaid。
- /labs/agent-replay/：复用同一 React 组件的独立页面，回放预置 Agent 步骤，不调用模型或后端。
- /demos/2026/rounded-timeline/：圆弧时间线 demo。
- /index.xml、/posts/index.xml、/weekly/index.xml、各标签与分类的 index.xml：RSS。

侧栏已移除最近修改列表；`/modified/` 的文章列表与入口继续保留。Giscus 按原有文章类型及 kind=page 注入，维持 pathname 映射、仓库、分类、URL 大小写和编码；目录页不注入。没有修改 GitHub Discussions。

## 内容与样式边界

BLOG_DIR 始终只读。构建层兼容 relref、前言字段、旧 URL、HTML、公式、代码和 Mermaid。路由基线在 scripts/legacy-routes.json，审计生成到 .generated/，不会发布。 历史 source 路径优先精确匹配；只有旧基线与当前源文件两侧均无大小写歧义时，才允许忽略大小写匹配。这样 Git 干净检出与本机文件名大小写不同时仍保留原 URL；显式修改 slug/url 仍按新配置生效。

现有 Blog 没有 MDX。新增交互文章目前放本站 src/pages/*.mdx，通过 Astro 原生编译；独立页面放 src/pages/，组件放 src/components/。在 Blog 添加 .mdx 会得到明确提示，避免错误地按普通 Markdown 发布。外部 Blog MDX 导入留待下一阶段，示例见 docs/demo-authoring.md。

新 UI 优先 Tailwind，其次 CSS Modules。通用 Book 外观兼容层、图标、公式字体和阅读脚本归主题包所有，本站专属页面与徽标配色的样式留在博客。主题保留 Hugo Book MIT 许可与来源。HeroUI 样式在博客局部加载，不向阅读布局引入全局 Tailwind preflight。

## 布局与响应式约定

既有页面沿用 Book 阅读布局、侧栏和交互。根据最新要求，所有栏目统一采用 Posts 文章详情的正文宽度；该要求取代旧 Hugo 列表宽页策略。对照必须使用相同浏览器与视口，并检查生成页面，不能只比较 CSS 源码。

- 页面、左右侧栏保留原滚动容器，根页面使用细滚动条与稳定占位；滚动时显示，停止 650ms 后隐藏。不要改为始终可见的默认滚动条，也不要用额外容器重做整页滚动。
- 左侧菜单保留 20rem 最小宽度和原 `max-content` / `clamp()` 上限。首页、Archives、标签、分类、Timeline、Weekly、Portfolio、Links 和 Labs 均使用 Posts 详情的正文列：最大 70rem，完整三栏容器最大 110rem。无右侧 TOC 的页面也保留相同的正文列宽，不再额外扩展正文；移动端正文随可用宽度缩放。
- Weekly、Timeline 与 Portfolio 使用本站的 HeroUI / Pro 组件；卡片、筛选栏与内容列随容器缩放，小屏保持单列可读，Timeline 保留日期锚点及右侧目录。历史卡片尺寸不再作为固定宽度约束。
- 筛选栏、右侧目录、年份选择器和分页保留原行高与控件；手机端分页缩小横向留白，并允许必要的换行。使用 Tailwind 字号工具时注意其附带行高，必要时只设置 `text-[length:…]`。
- Archives 年份链接滚动到当前页对应 ID；主题的通用标签、分类路由继续独立可用。检查桌面、超宽屏和手机端，并确认宽表格、代码块的滚动仍限制在自身区域。

## 两个仓库的协作方式

`astro-book` 独立维护通用布局、导航/TOC、文章元数据与列表、搜索界面、图片查看、Giscus 展示，以及 Markdown/MDX 的 KaTeX、Mermaid 和默认的 Astro / Shiki 静态高亮与轻量复制。主题已移除 Expressive Code，仍提供 `markdown.code: false` 与布局 `code={false}`，允许消费者替换普通代码渲染。主题使用合成示例内容，安装、构建、测试不需要商业组件或账号；组件和 integration 都通过公开包入口使用。

本站保留 Blog 导入、Hugo 兼容、旧 URL、标签/分类关系、排序和分页、RSS/sitemap、站点菜单、SEO 策略、Giscus 参数与资格判断，以及 React/HeroUI/HeroUI Pro/Svelte demo。Weekly、Timeline、Portfolio、Links 的路由、数据、业务组件、展示类型和专用样式也全部留在本站，后续可以独立迭代。HeroUI Pro 是博客自己的依赖，用于普通文章/MDX 的代码块以及交互 demo；主题保持无商业依赖。`src/layouts/BookLayout.astro` 是站点到主题的适配层。

博客关闭主题的普通代码块展示及 Astro 静态高亮，完整原文仍在构建 HTML 的 `pre/code` 中。阅读到代码附近后，共享 React root 按帧挂载 Pro CodeBlock，使用现成的高亮与复制按钮；禁用 JavaScript 或组件加载失败时保留可读原文。普通文章只加载 CodeBlock / Button 所需样式。Mermaid 图表使用主题的轻量源码复制；普通代码不会出现双框或双复制按钮。此选择增加了阅读代码时的 React、Pro、Motion 与 Shiki 客户端成本，具体策略见 [Demo 编写指南](demo-authoring.md#普通文章与-mdx-代码块)。

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

此模式会使用本地修改并更新 tarball 的 lockfile 完整性，供开发验收；不要把只有本机能构建的 lockfile 提交到共享分支。联调通过后先推送主题、更新本站来源 commit，再不设置 `ASTRO_BOOK_DIR` 执行 `npm run theme:sync`；或不设置该变量直接同步原有固定提交以恢复基线。`npm run setup` 始终使用提交的来源，忽略 `ASTRO_BOOK_DIR`。主题更新会参与 Markdown 缓存指纹，避免同版本本地迭代仍显示旧渲染结果。

首次固定来源安装的历史验证使用没有 `node_modules`、主题源码或预存 tarball 的临时目录：固定主题先构建，再完整安装本站依赖，lockfile 字节保持不变；当时安装的 125 个主题文件与打包产物逐字节一致，主题公开入口、CSS、HeroUI Pro 与 React/Svelte integration 均可解析。本站 Node 24 生成的 lockfile 在该 Node 26 环境也通过校验。此记录对应当时的主题版本，并使用本机现有 HeroUI Pro 授权环境；更换主题提交后仍须重新验证，新的开发机器或 CI 也须配置自己的授权。

既存 Python 语言基础 .md 与 _index.md 路径冲突按 Hugo 实际行为处理：保留目录页，被覆盖正文只记录审计。大小写不同且会在 macOS 文件系统相互覆盖的别名写入 Cloudflare _redirects，不覆盖真实页面。

## Cloudflare 生产发布

`wrangler.jsonc` 通过 Workers Static Assets 将 `dist/` 发布到生产 Worker `tcitry-blog`，绑定 `yindongliang.com`。没有主站 Worker 业务代码或后端 API，也不再维护独立预览 Worker。

先构建生产产物并在本地 review，再直接发布这份 `dist/`：

```sh
BLOG_DIR="$HOME/Blog" npm run build:production
npm run check
npm test
npm run verify:production
npm run preview -- --port 4321
# 浏览器确认这份生产产物后发布；此命令不重新构建。
npx wrangler deploy
node scripts/verify-deployment.mjs --env production
```

生产构建显式设置 `PUBLIC_SITE_ENV=production`，允许收录并启用原有统计；HTML、robots.txt 和响应头不得误带预览环境的 noindex。不要把普通预览构建直接上传生产。日常也可用 `npm run deploy:production` 重新构建、校验并发布；它会替换之前 review 的本地构建产物。

生产 HTTP 验收默认访问 `https://yindongliang.com`，覆盖核心页面、Giscus、RSS、搜索、旧 URL 重定向、实际 404 和资源缓存；`--all-routes` 可扩大到全部页面。发布授权、`www` 跳转及可选自动化的维护方式见 [生产发布说明](continuous-deployment.md)。

## 已下线的迁移预览（历史）

迁移初期使用过 `preview.yindongliang.com`、Worker `tcitry-astro-preview` 及其 workers.dev 地址，首次部署版本为 `40735e8f-5301-4b9b-8ac3-a7f32839523e`。这套预览现已下线；以下验收记录只说明当时的迁移结果，不再提供预览部署操作。

## 首次迁移验收记录（历史）

以下保留首次迁移、主题提取和公网发布时的检查结果。后续主题引入 Expressive Code、博客采用 Pro CodeBlock、业务组件迁回博客及侧栏/demo 调整，均须按当前提交重新验收；这里的数字不代表后续提交已通过全量检查。主题当前已切换到 Astro / Shiki 静态高亮与轻量复制，以下 EC 验收记录仅描述当时状态。当前机器检查产物位于 `.generated/`，需要核对其生成时间和构建来源。

- 全部 1,208 个原有公开 URL 在新构建中保留；包含旧目录大小写、中文编码与文章 permalink。
- 102 个可见导航分组与受控 Hugo 输出逐组比较，顺序一致。
- CUA 对比首页与同篇 Docs，桌面三栏尺寸一致；390px 宽度下菜单、目录与实验页无横向溢出。
- 搜索、代码复制、Giscus iframe、Timeline 年份切换、59 期 Weekly、13 项 Portfolio，以及 React/Svelte 的真实交互已验收。
- 当时集中渲染 103 个 Mermaid 图表：102 个成功。唯一失败来自 Kubernetes《节点组件详解：角色、职责与交互》的既存 sequenceDiagram，当时保留源码降级。该激活/停用语法错误已在 2026-09-07 的内容更新中修正；更新后的内容审计通过 106 个 Mermaid 图表和 497 个公式节点。
- LaTeX 保留旧定界符，金额不会跨粗体边界误吞正文；构建产物中没有 KaTeX 错误。

机器检查结果在 .generated/verification.json；内容兼容诊断在 .generated/content-diagnostics.json。原有外链与引用的编辑问题未修改。

## 当前本地架构与渲染验收（2026-09-07）

- `build:production`、`verify:production`、35 个文件的 Astro 检查和 28 项测试通过；1,229 个页面路由保留全部 1,208 个旧 URL，954 个 Giscus 页面继续按原 pathname 映射。
- 开发模式逐页验证 67 个 Mermaid 页面、106 个实际 SVG，未出现渲染失败。内容语法审计另通过 497 个公式节点。
- `test:browser` 在 dev 和生产产物 preview 均通过：无 React island 的两篇文章中，6 个 HeroUI Pro 代码块、3 个图表及原文复制正常，没有重复复制按钮或客户端模块错误。
- Labs 的 Pro/OSS 下拉选择、真实右侧 TOC，以及 Timeline、Portfolio、Weekly 在 320px、375px 和桌面视口的布局与交互通过浏览器检查。
- 统一正文宽度后，对 Posts 详情、首页、栏目与标签/分类详情等 17 个页面完成 4 种视口共 68 次测量：1920px / 1440px 下正文分别为 1088px / 768px，375px / 320px 下分别为 343px / 288px。有无 TOC 的页面均与 Posts 详情同宽、同一起点，整页无横向溢出；Labs 和 Links 的移动目录及原有阅读浏览器回归继续通过。

以上浏览器检查先在本地主题开发包完成。生产发布时先推送主题提交，再更新本站固定来源与 lockfile，从该来源重建并复验；线上状态以 Wrangler 发布结果和生产 HTTP 验收为准。

## 首次独立主题接入验收（2026-09-07，历史）

- 主题已从独立仓库打成真实 tarball 并安装到本站，没有工作区源码链接或跨仓库深层导入。
- 独立主题构建、完整源码检查和 16 项渲染/样式测试通过。隔离临时消费者通过 tarball 安装主题、通过公开 registry 安装依赖，4 页构建通过，Markdown/MDX 各自包含公式与图表，59 个字体引用均在本地可用；消费者不配置 Tailwind 编译器，也不需要 React 或商业组件授权。
- 本站检查 0 错误/0 警告；10 项兼容与缓存测试通过；依赖审计 0 漏洞。当时构建验证 1,225 个页面路由，保留全部 1,208 个旧 URL，950 个 Giscus 页面、25 个公式页面、65 个 Mermaid 页面、622 个代码页面。
- 与提取前静态副本比较，所有旧 HTML、title、canonical、TOC、分页、周刊、时间线和作品数据保留。导航主体链接顺序、active 和无链接分组控件一致。过程中其它工作向 Blog 增加了一篇文章及引用，因此总数、最近修改窗口和少量上下篇发生相应变化；本任务未编辑 Blog 原文。
- 固定 1280px 视口：首页三栏仍为 320/640/320px，导航字号仍为 14px，首行位置及行距一致。周刊、作品、时间线的内容高度与基线一致；归档旧文章逐行高度一致。标签云原有不换行问题修复，标签/分类页不再产生整页横向滚动。
- 本站 Pagefind 搜索 SwiftUI 返回 261 条；文章复制按钮进入成功状态，Giscus iframe 正常加载。实验页 React/HeroUI Pro 完成 7 帧回放，Svelte 计数与派生值更新，深色下公式和 Mermaid 正常；新增阅读主题选择器可切换系统/浅色/深色。
- 390px 手机视口下两个 demo 各 358px，整页不溢出，导航正常展开。主题独立示例还验证了长公式/宽图/表格局部滚动、图片查看与焦点恢复、多个错误 Mermaid 独立保留源码，以及明暗切换后重新渲染。

当时主题构建有 Mermaid 分块体积提示和旧代码复制兼容回退的弃用提示；后续主题默认代码组件改用 Expressive Code，博客随后选择 Pro CodeBlock。Mermaid 通过动态导入按页面需要加载。这一阶段未进行 Lighthouse 性能测量，主题也未发布 npm。

## 首次 Cloudflare 迁移预览验收（2026-09-07，已下线历史）

- 自定义域名及 workers.dev 备用域名均通过 HTTPS 返回 200。
- 23 项 HTTP 检查通过：首页、实验室、文章、标签/分类、时间线、周刊、作品、友链、RSS、sitemap、搜索脚本、CSS/JS/字体、尾斜线跳转、大小写旧别名和缺失页 404。
- HTML 与响应头保持 noindex，robots.txt 禁止抓取，canonical 指向生产站；带哈希资源使用一年 immutable 缓存。
- 公网浏览器中 React/HeroUI Pro 完成 7 帧回放，Svelte 计数与派生值更新；2 个公式、Mermaid 和深色切换正常。Pagefind 搜索 SwiftUI 返回 261 条。
- 文章底部 Giscus 正常显示表情和评论区，仍在前后页导航之后；实际 widget 的 term 保留原始 pathname，未写入或更改 Discussions。

HTTP 检查记录在 `.generated/cloudflare-verification.json`。Cloudflare 对 Python urllib 默认客户端返回 1010；上述检查使用 curl，并用真实浏览器交叉验证，未调整账户的安全规则。

## Pro 接入与首次集成验收（2026-09-07，历史）

本轮使用公开主题提交 `c9f83e2f8ce43d8d9ab95f64a9b10a8f3dbf9d4f`，未设置 `ASTRO_BOOK_DIR`，从远端固定来源重新打包并同步 lockfile。

- 本站构建 1,226 个页面，完整保留 1,208 个旧 URL；包含 951 个 Giscus 页面、25 个公式页面、65 个 Mermaid 页面、623 个代码页面。Feeds、搜索、既有 demo、MDX/React/Svelte 与预览收录策略检查通过。14 项测试通过；28 个文件的 Astro 检查为 0 错误、0 警告。
- 主题通过 27 项测试和类型检查；独立示例构建 13 页。真实 tarball 的隔离消费者检查通过，包含 Markdown/MDX、公式、图表、搜索与 59 个本地字体资源，不需要 React、HeroUI Pro 或博客内容。
- 博客以 `markdown.code: false` 和布局 `code={false}` 关闭普通 EC 展示，在生成 HTML 前处理代码 AST；MD 与 MDX 使用同一适配。没有先生成 EC 再拆解 HTML，也没有添加 renderer/provider 注册层。主题自己的默认 EC 保留文件名、行号、标记、高亮和复制。
- Lab 中 HeroUI 表单、Pro 消息/步骤/来源/代码复制、回放与暂停，以及 Svelte 状态和派生值均通过浏览器操作验证。普通 MDX 和文章代码的剪贴板内容与完整静态原文一致，保留末尾换行。明暗主题下代码高亮可读，没有双框或双复制按钮。
- 包含 154 个代码块的 Kubectl 页面，顶部稳定后只挂载附近 5 个 Pro 块，向下阅读后增至 10 个，始终共享一个 React root；初始 HTML 保留全部 154 段原文。这里只验证按需挂载行为，未进行 Lighthouse 或 CPU 性能测量。
- 2560px 下侧栏恢复 Hugo 的 max-content、20rem 最小宽度和原有 clamp 最大宽度，左侧起点为 0；Weekly 卡片与封面保持 320px、320×192px，间距 16px。390px 下 Weekly、归档和 Timeline 无整页横向溢出；Doc/ByAI/其他标签横向间距 4px、换行间距 2px。Timeline 年份选择实际跳转到 `/timeline/2025/`。

独立主题文档示例位于 `astro-book` 的 `examples/basic/`，可在主题仓库运行 `npm run build`、`npm run preview -w @astro-book/basic`。本次本地验收地址为 `http://127.0.0.1:4322/astro-book/`，已验证带 base 路径的搜索、移动导航、EC 复制与明暗主题，以及 Mermaid 展示和原始源码复制。

当时独立主题的目标公开地址为 `https://tcitry.github.io/astro-book/`，因 GitHub Pages 继承用户站点自定义域名而未发布，文档工作流通过域名检查跳过部署。这个历史结果不代表主题文档站的当前状态；博客现已迁入 Cloudflare，GitHub Pages 解绑步骤见 [生产发布说明](continuous-deployment.md#github-pages-自定义域名解绑)。

当时的预览部署在 `preview.yindongliang.com`（现已下线），Cloudflare 版本为 `9bda6e8a-d93a-424d-90e4-e4a9a0ee134f`，对应实现提交 `dc1f7ed7b`。20 项 HTTP 检查通过，包括菜单顺序、旧文章静态代码、Giscus pathname、noindex、robots、RSS/search、404/尾斜线与不可变资源缓存。公网浏览器验证 Pro 组件激活、回放/暂停、完整结果与代码原文复制，未出现控制台错误。该记录使用显式 Wrangler 发布；当前流程见 [生产发布说明](continuous-deployment.md)。


## Hugo 布局对齐与 Kumo 清理验收（2026-09-07，历史）

本轮使用公开主题 `f5066d2f0bd591800dcd7433357a60e77b7b38da`，从 Blog `main` 已提交版本 `f405f1beaeaac13fe84f3a17bc55d5a5673471d7` 的干净副本构建。

- 构建 1,226 个页面，保留全部 1,208 个旧 URL；951 个 Giscus 页面、25 个公式页面、65 个 Mermaid 页面、623 个代码页面通过检查。24 项测试通过，31 个文件的类型检查零错误、零警告。
- 同一浏览器在 390、1920、2560px 视口对比 Archives、Weekly、Timeline、Portfolio，根滚动条及容器、侧栏的宽度、位置、内边距、overflow 测量与 Hugo 一致。Weekly 卡片仍为 320px、封面 320×192px；13 个 Portfolio 卡片在桌面与手机端的高度均与原站一致。
- 根滚动条恢复细线、透明默认状态、滚动中显色和 650ms 隐藏。Archives 桌面/手机年份锚点、亚像素位置、页末年份与文章嵌套目录高亮通过实际操作检查；恢复原分页窗口和首末页控件。
- 删除 Kumo 演示源码、路由、依赖，以及 Blog 导航中的演示区块和静态文件。旧静态目录有发布排除和产物缺失断言，圆弧时间线保留。HeroUI 表单、Pro 回放与代码复制实测通过。
- 主题 UI 继续使用 Tailwind CSS v4 / CSS Modules，无 React、HeroUI、HeroUI Pro 或 Kumo 运行依赖。React 与商业组件只存在于博客消费方；独立主题示例不使用这些依赖。
- 干净检出发现并修复 6 处文件名大小写差异导致的 URL 漂移，使用双侧唯一的历史 source 匹配；保留显式路由变更和歧义保护，并覆盖回归测试。

该产物当时使用 Wrangler 发布到 `preview.yindongliang.com`（现已下线），实现提交为 `6ac71c40fa59bdaed079fab2ecd5a03a388a4fa5`，Cloudflare 版本为 `9817d629-7081-4f58-acc4-6b8ac1e50bc5`。22 项公网 HTTP 检查通过，包括已移除 demo 的 404、Cloudflare 概览无旧 demo 引用、归档年份锚点、Giscus pathname、noindex、RSS/search、尾斜线与 immutable 缓存；公网浏览器确认根滚动条为 thin / stable，年份点击保留当前页面并正确高亮。本次直接发布已验证的 `dist/`，没有从 Blog 未提交的工作区内容重新构建。

独立主题 README 已移除临时迁移预览链接，仅保留 `yindongliang.com` 作为使用方示例；该文档修改不改变本站固定主题的运行代码。当时发布为手动 Wrangler 操作，当前约定仍是本地 review 后直接发布生产，见 [生产发布说明](continuous-deployment.md)。

## 搜索能力归入主题（2026-09-07）

主题升级到 `0207160353e44a81146ec2159e15cc8b8afd508d`：Pagefind 依赖、索引构建和搜索界面统一由 astro-book 维护，本站仅保留范围与中文配置。原 `pagefind.yml` 的 `glob` 和 `root_selector` 已迁入 `astro.config.mjs`。

使用 Blog 内容提交 `f405f1beaeaac13fe84f3a17bc55d5a5673471d7` 的干净副本构建生产产物。新旧索引的 968 条记录逐项比较完全一致，包括地址、正文和元数据；本地中文搜索可正常跳转原文章地址。本站 check、26 项 tests 和 verify:production 通过，保留全部 1208 个原有 URL，并通过 Giscus、公式、Mermaid、代码块及生产收录策略检查。主题独立文档站的 33 项测试、打包安装和 GitHub Pages 搜索也已通过。
