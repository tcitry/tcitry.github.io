# Astro-book 演示与交互式文章

当前验证入口：

- `/lab/`：[Astro-book 展示页](https://preview.yindongliang.com/lab/)，从顶部菜单 **About** 之后的 **Astro-book** 进入，汇集主题说明、使用文档及 MDX 中的 Astro、React 与 Svelte 组件演示。
- `/lab/agent-replay/`：复用同一个 React 组件的独立页面。

第一阶段的演示文件都在站点仓库内，`Blog` 内容保持只读。Agent 演示仅播放本地预设数据，不调用模型或后端，也不收集输入。

本站采用 Astro + `@tcitry/astro-book` + Tailwind CSS v4，并在 React 交互组件中使用 HeroUI。HeroUI Pro 是本站额外接入的商业组件；独立的公开主题不依赖 React、HeroUI 或 HeroUI Pro。主题本身的使用方式见 [中文 README](https://github.com/tcitry/astro-book/blob/main/README.zh-CN.md)、[入门指南](https://github.com/tcitry/astro-book/blob/main/docs/getting-started.md) 与 [公开 API](https://github.com/tcitry/astro-book/blob/main/docs/architecture.md)。

## 主题与自定义页面

`astro-book` 聚焦 Hugo Book 的通用阅读能力：布局、导航、TOC、文章元数据与列表、提示、标签展示、分页、Markdown/MDX 渲染、搜索与评论展示。通用 `GroupedArticleList` 只接收已分组的文章，不处理博客的专题类型或分组规则。

Weekly、Timeline、Portfolio、Links 和本页 demo 属于 `tcitry.github.io`。它们的路由、数据规则、组件和专用样式都留在本站，可以独立改为 React / HeroUI 实现，不需要向主题添加博客业务约定：

```text
src/components/book/
  WeeklyCards.astro           周刊封面卡片
  Timeline.astro              年度时间线
  YearSelect.astro            时间线年份切换
  Portfolio.astro             作品集
  LinkRows.astro              周刊与时间线的专用侧栏
  special-pages.ts            上述页面的展示类型
  Timeline.module.css        时间线与作品集的局部样式
src/styles/blog.module.css    本站徽标配色与文章附注
```

这些组件目前保留既有页面的结构与内容。新样式使用 Tailwind utilities；必须作用于已渲染正文节点的规则放在 CSS Modules，不复制回主题。

## 组件与内容边界

```text
src/components/demos/
  HeroUIShowcase.tsx          HeroUI 编辑/预览、按钮状态、标签与折叠面板
  AgentReplay.tsx             React 状态、HeroUI 控件、HeroUI Pro 消息/步骤
  SvelteCounter.svelte        Svelte 状态、派生值与双向绑定
  DemoSurface.module.css     将 Book 主题变量传给 demo 的 HeroUI tokens
src/pages/lab/
  index.mdx                  主题说明、文档入口与 MDX 多框架演示
  agent-replay.astro          独立页面复用 AgentReplay
src/layouts/LabLayout.astro   为 MDX 适配现有 Book 布局
src/styles/
  tailwind.css               Tailwind v4 utilities，不导入全局 preflight
  demos.css                  仅导入当前用到的 HeroUI / Pro 组件样式
```

交互组件管理自己的状态，不依赖外层 Astro 模板的运行时。复杂演示应放在一棵完整的框架组件树内；跨框架传递初始数据时使用可序列化 props。

## MDX 中嵌入

```mdx
import AgentReplay from '../../components/demos/AgentReplay';
import SvelteCounter from '../../components/demos/SvelteCounter.svelte';

<AgentReplay client:visible />
<SvelteCounter client:visible />
```

`client:visible` 保留构建期 HTML，并在组件接近可见区域时加载交互运行时。独立演示可以用 `client:load`，两处导入同一份源码。必要时可使用 `client:only="react"` 承载仅浏览器可用的组件，但该区域将失去构建期 HTML，应优先解决模块顶层访问 `window` 等问题。

大型 Three.js 场景或完整独立应用可使用点击启动或单独页面。特殊依赖版本的实验再采用独立构建或 iframe。不要为了简单嵌入复制两份组件代码。

## 样式

新增界面优先使用 Tailwind v4 的 class；不适合表达为 utilities 的部分使用 CSS Modules。`DemoSurface.module.css` 负责 demo 范围内的基础样式重置、少量兼容覆盖，以及读取 Book 明暗主题变量的 HeroUI token 映射。

HeroUI v3 不需要 Provider。React 控件使用 `onPress`、compound API（如 `Slider.Track`），Pro 组件从 `@heroui-pro/react` 的实际导出路径导入。

当前导入的 Pro 组件是 `ChatMessage`、`ChainOfThought`、`ChatSource` / `ChatSources`、`ChatMessageActions` 和 `CodeBlock`；思考步骤内部使用 `TextShimmer`。基础样式按组件引入，并加载 HeroUI 所需的 `tw-animate-css` utilities。新增组件时应补齐组件及其内部依赖的 CSS，而不是直接导入 `@heroui/styles` 总入口，因为总入口包含全局 Tailwind preflight，会改变现有文章排版。

`DemoSurface.module.css` 将 Book 颜色映射到 HeroUI 的 surface、field、overlay 和状态变量。浮层会挂到岛屿容器之外，因此 `Select.Popover` 也显式使用同一个局部 class；测试时需实际打开选择器，并在浅色、深色和窄屏下检查。

## 优先使用现成组件

`HeroUIShowcase` 用现成的 TextField / Input、Select / ListBox、Switch、Card、Tabs、Button、Chip 和 Accordion 组合文章编辑预览。修改标题、分类和标签开关会即时反映到卡片；收藏和按钮反馈只存在于本次组件状态，不写入 Blog。

Agent 演示初始显示完整结果：3 个步骤、4 段回答，以及来源、代码与操作。重新回放时分为 7 帧，可以暂停、调速、重置或跳回完整结果。Pro 的消息正文默认留有较大侧边空白，本站通过 Tailwind 调整为 `pe-0`，并按演示容器宽度安排头像与正文，避免手机上回答过窄。

Agent 中的交互式代码示例使用 `@heroui-pro/react/code-block` 的 `CodeBlock.Code` 与 `CodeBlock.CopyButton`，直接复用高亮、复制和成功图标。Shiki 在交互示例中由这个现成组件按需使用，SSR 初始代码仍可读。

普通 Markdown、MDX 和 Lab 页的 Markdown 代码示例也使用本站的 Pro CodeBlock 适配。新增示例直接使用 Markdown 围栏，已有 demo 组件中的 Pro 代码块由组件自己管理，不会再次包装。

消息操作使用 `ChatMessageActions.Copy` 和 `Regenerate`。`Copy` 提供按钮与图标，但实际文本仍由调用方写入 Clipboard；本站只在写入成功后设置 `isCopied`，失败时显示可选中文字的提示。`CodeBlock.CopyButton` 则已经自带复制行为，不重复绑定。

## 普通文章与 MDX 代码块

主题默认的 Expressive Code 保持可用，本站通过 `astroBook({ markdown: { code: false } })` 与 `BookLayout code={false}` 选择自己的渲染器。仅博客依赖 HeroUI Pro，主题没有商业包或商业代码。Mermaid 继续使用主题的图表渲染与 EC 源复制。

`src/lib/markdown.mjs` 中的 `remarkBlogCodeSource` 保留代码内容、注释、空白及实际末尾换行；`rehypeBlogCodeBlocks` 为普通代码生成 `data-blog-code` 容器。它同时用于传统 Blog 的 `set:html` 输出和 Astro 原生 MDX，不能只靠 MDX `components.pre` 替换。`data-demo` / `data-book-island` 中的代码由其组件管理。

构建 HTML 内保留一份真实的 `pre/code` 原文，搜索和无 JavaScript 阅读不依赖 React。本站显式关闭 Astro 的静态代码高亮，避免它在插件前剥离末尾换行；彩色高亮在 Pro 挂载后出现。没有隐藏的重复 JSON 代码副本。加载或组件渲染失败时静态原文保留；未知语言由 Pro 回退为纯文本。Pro 复制按钮直接复制原文，不会去掉终端注释或额外调用另一套复制逻辑；当前上游按钮复制失败时没有错误提示，可直接选中文字复制。

`src/scripts/blog-code.ts` 使用一个 IntersectionObserver，在代码进入视口外 300px 范围时加载共享的 React / Pro 模块，并每个动画帧挂载一个代码块。`src/components/code/BlogCodeBlock.tsx` 使用一个 React root 和多个 portal，已挂载组件保留至离开页面；切换页面时清理 root、观察器和队列。普通文章动态加载 `code-vendor.css` 中的 Button / CodeBlock 样式，不加载整份 `demos.css`。

这减少了长文首屏同时初始化的代码数量，但不是零客户端成本：第一次阅读代码需要加载 React、HeroUI Pro、复制动画使用的 Motion 和 Shiki，已阅读的代码块也会占用内存。大段代码的高亮仍在浏览器主线程运行；300px 预加载不能保证慢设备上完全没有等待。明暗配色随 Book 的系统/浅色/深色切换，无需重新请求高亮结果。

验收长文时，可使用 `/docs/Kubernetes/Kubectl-速查手册/` 或 `/docs/Kubernetes/helm-core-concepts/`：对比初始静态代码数量和 `data-blog-code-ready` 数量，向下滚动后应逐步增加。需要实测网络与主线程成本，不能将按需加载等同于性能检查已通过。

## HeroUI Pro 安装与构建

锁文件包含公开安装包信息；实际授权产物在安装时由官方安装器下载到 `node_modules`。不要提交 Pro 缓存、授权产物、登录文件或 token。

本机已通过已有授权完成安装，使用的授权产物版本为 `1.0.0-beta.8`。首次检出或清理 `.artifacts/` 后，先准备固定来源的主题包并安装依赖：

```sh
npm run setup
```

主题 tarball 已准备且与 lockfile 一致时，可以单独用 `npm ci` 恢复依赖。若仅 HeroUI Pro 授权产物缺失，在已登录的机器上运行：

```sh
npx heroui-pro@1.0.0-beta.12 status
npx heroui-pro@1.0.0-beta.12 install react --yes
```

在 CI 构建时，通过 CI 平台的 secret 注入官方仪表盘提供的 **CI/CD token**，变量名为 `HEROUI_AUTH_TOKEN`。`npm ci` 的 postinstall 会读取它并下载授权产物。应使用专门的 CI/CD token，不复制个人登录凭证。该变量没有 `PUBLIC_` 前缀，不进入客户端源码、构建参数或日志。

Cloudflare 只托管构建后的静态产物时不需要运行时授权 token；只有负责执行 `npm ci` 的构建环境需要它。当前可以在已有授权的本机完成构建并发布预览。

官方说明：[HeroUI Pro 安装与 CI/CD](https://heroui.pro/docs/react/getting-started/installation)。

## 已迁入 Astro 的独立演示

| 地址 | 组件 | 运行方式 |
| --- | --- | --- |
| `/demos/2026/rounded-timeline/` | `src/components/demos/RoundedTimeline.astro` | 四张卡片静态生成，小脚本通过 ResizeObserver 更新连接线 |
| `/demos/2026/cloudflare-product-map/` | `src/components/demos/CloudflareProductMap.tsx` | React + Kumo 在构建时输出 HTML，文档链接无需 hydration |

入口位于 `src/pages/demos/2026/`，共用轻量 `DemoLayout`。它们保持原 iframe 地址和全屏布局，随根项目 `npm run dev` / `npm run build` 一起运行。预览环境使用 noindex，canonical 指向生产域名。

这两个演示不再使用单独的 Vite 工程或把产物写到 Blog。`prepare-assets` 会忽略 Blog/static 中对应的旧目录，让 Astro 产物成为唯一发布来源；其他已有静态演示继续正常复制。修改展示逻辑时编辑组件及其 CSS Module，保留文章中的既有地址。

## 验证

```sh
npm run check
npm run build
```

检查 `/lab/` 与 `/lab/agent-replay/`：

- HeroUI 的标题、分类和标签开关即时更新预览；收藏、恢复示例、Tabs、按钮反馈和 Accordion 可操作，Select 浮层不会被裁切。
- Agent 初始完整结果包含 3 个步骤、4 段回答、来源与代码；7 帧回放的开始、暂停、恢复、完成、重放和重置均可用，修改速度立即作用于下一帧。
- Pro 代码复制按钮和消息复制按钮实际写入对应内容，不能仅检查图标状态；普通 Markdown 代码复制也继续可用。
- 暂停或重置后没有旧定时器继续推进；切换页面后计时器被清理。
- Svelte 计数、步长和派生值可更新，不影响 React 状态。
- MDX 中公式、代码复制和 Mermaid 与正文页面行为一致。
- 禁用 JavaScript 时正文、公式和初始组件 HTML 可读。
- 明暗主题、窄屏、键盘焦点及页面导航保持可用。

演示组件留有 `data-demo` 与少量 `data-testid` 属性，方便浏览器验收定位；它们不参与业务逻辑。

原生 MDX 的数学公式使用 `$...$` 或 `$$...$$`，美元金额写作 `\$10`。旧 Blog Markdown 的 `\(...\)` / `\[...\]` 则由迁移兼容层处理。
