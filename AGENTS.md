# 仓库约定

## 通用开发规则

- 与用户使用中文交流。
- 当用户提到、咨询、设计、实现或排查 `tcitry-blog` 的功能时，只在对话及必要的站点工程中处理，不得自动在 Blog 创建或更新技术文档（包括流量统计、功能使用分析与转化优化）。仅在用户明确要求撰写或更新 Blog 文档时才进行文档沉淀；此规则优先于 Blog 的一般自动沉淀与知识库写回约定。
- 站点项目今后统一称为 `tcitry-blog`，不再用 `tcitry.github.io` 作为日常项目称谓，避免与域名混淆；本站已不使用 GitHub Pages 托管。真实 GitHub 仓库 URL、Git remote、Giscus `repo` 标识及历史路径仍按实际值保留，名称约定本身不表示重命名远端仓库或修改这些配置。
- `hugo-book` 备份分支中的开发规则继续有效；Hugo 迁移到 Astro 只改变技术实现和入口，不取消 URL、评论兼容、内容边界或验证要求。
- 日常在 `tcitry-blog` 站点检出的 `main` 分支工作。迁移前的主分支是 `master`；不要将它误记为旧 `main`。临时 worktree 完成合并后再清理，先确认没有未提交工作或需要保留的本地文件。
- 本站使用 Astro + `@tcitry/astro-book`，业务覆写维护在 `src/`，通用主题实现维护在独立 astro-book 仓库。`package.json` 是安装、开发、构建、检查和发布的唯一权威入口；`main` 不保留 Makefile 或 Hugo 专用入口、模板、样式与构建配置，旧实现到 `hugo-book` / `master` 备份分支查阅。Astro 仍依赖的旧 URL 基线、内容兼容层、评论规则和验证必须保留。
- 改写 Blog 技术文档的术语、中文导读或 Mermaid 时，读取 [blog-technical-docs Skill](skills/blog-technical-docs/SKILL.md)，并以 Blog 内容仓库当前的 `Agents.md` 为准。Contract Testing 文章是已验收示范；“其他文档”的批量改造默认不重复改写它。

## Astro 生产与预览

- `main` 是 Astro 生产及默认分支，`astro` 保留迁移历史并可用于本地验证，不对应远端环境。切换前的默认分支实际名为 `master`；保留该旧分支。`hugo-book` 的远端备份 `ce25b344d48e561f6420f727f43509c4f478e8d9` 包含旧生产提交 `d02f8b83854f7eff39b32b00c1d585d4f3567d7c` 和后续已提交的 Hugo 工作。
- 仅保留生产 Worker `tcitry-blog`，使用默认配置 `wrangler.jsonc`；`PUBLIC_SITE_ENV=production` 仅控制生产产物的收录策略，不代表另一个 Wrangler 环境。先本地 review，再执行 `build:production` / `verify:production` / `deploy:production`（或 `deploy`）。普通 `build` 默认生成本地 noindex 预览产物；不得将它发布到生产域名。迁移使用的远端 preview 环境已停用，不再创建预览 Worker。
- `build:workers` 默认自动获取 Blog 远端 `main`，在每次构建开始时解析并固定内容提交，构建期间不再追随分支变化；内容审查应在推送到发布分支前完成。日常不得要求用户手工维护 `BLOG_CONTENT_COMMIT`，该变量仅作为回滚或复现时的可选覆盖。Workers Builds 已连接站点仓库并仅构建 `main`；2026-09-08 已完成首次 Git push 云端构建、部署与线上验收，Blog 内容通知仍待一次性 Deploy Hook secret 配置及实测。Blog 的 `blog-content-updated` 通知由站点 `.github/workflows/content-update.yml` 接收，通过 Actions secret `CLOUDFLARE_DEPLOY_HOOK` 请求云端构建；Hook 只需配置一次，通知中不传私有内容或 SHA，Actions 触发成功不等于部署成功。公开主题 CI 成功不能当作博客已部署。旧 Hugo GitHub Pages 工作流已停用，GitHub Pages 自定义域名按持续部署文档由用户手动移除。
- `www.yindongliang.com` 通过 Cloudflare Redirect Rule 301 跳转到主域，保持路径和查询参数，不使用额外 Worker。主站日常发布无需修改这项稳定规则。
- 首次检出使用 `npm run setup`，先准备固定提交的 `@tcitry/astro-book` 包，再安装站点锁定依赖。主题在独立公开仓库维护，使用公开导出，不把主题实现复制到本站。
- `BLOG_DIR` 是只读内容源。私有内容、生成文件、凭据和安装后的商业组件源码不得进入 Git。React / HeroUI Pro demo 包装组件属于本站，不属于公开主题。
- 主题默认使用 Astro 自带的 Shiki 与小型复制功能；本站继续通过关闭与替换接口使用 HeroUI Pro CodeBlock。不得因主题简化而把本站代码块改回主题默认展示。
- 全站正文宽度以 posts 文章详情页为统一基准。Archives、Tags、Categories、Timeline、Portfolio、Links 等索引或业务页面不单独启用宽页布局；没有右侧目录时也不扩大正文列。Weekly 列表及分页是用户明确指定的例外：不保留右侧 TOC 空白，卡片在足够宽的桌面内容区域显示 4 列，较窄区域依次为 2 列、1 列；单篇 Weekly 正文继续使用统一文章宽度。调整后核对桌面实际宽度与移动端溢出。
- Posts 的“相关阅读”属于文末推荐，不加入桌面或移动端文章 TOC；文章目录只展示正文结构。
- Weekly 列表每页显示 40 期，桌面 4 列时每页 10 行，使用 HeroUI Pagination，保留可在无 JavaScript 时导航的真实页面链接；首页为 `/weekly/`，后续页使用 `/weekly/page/<页码>/`，各页继续按日期倒序排列。
- 侧栏搜索使用明确的 Command 触发按钮，与外观菜单并排放在品牌下方。按 HeroUI design taste 与站点中性色统一尺寸、对齐和交互；外观保留跟随系统、浅色和深色三种模式，图标按钮提供 Tooltip、可访问名称与当前选中状态。
- 博客助手的 AI Chat 侧边栏样式参考用户提供的 HeroUI Agents demos，使用现有 HeroUI Pro 聊天组件，保持紧凑的单行顶部栏、中性背景与用户气泡、底部圆角输入框和清楚的文章出处。操作入口只展示已实现的能力，不因参考图包含附件、模型选择或语音控件就添加无效按钮。
- 空正文栏目入口由 `scripts/site-pages.mjs` 维护，Blog 不再需要 `archives.md`、`ghstar.md`、`modified.md`、`portfolio.md`、`timeline.md` 占位；栏目 URL 与既有元数据继续保持兼容。
- 修改主题或渲染后，运行站点 build、check、tests 和 verify；生产验收使用对应的 production 命令。保持旧 URL 基线和 Giscus pathname term。
- 生产发布使用独立检出、独立依赖与缓存、独立 `dist/`，内容固定到已审查提交。不得从其他任务仍可能构建的共享工作区发布；`verify:release` 校验生产产物并记录来源与哈希，`deploy:verified` 只上传该份已验收产物；Wrangler 上传期间不能重建或改写资产目录。发现产物被并行改写时，中止上传，确认线上版本，再从独立目录重建、复验和发布。
- `tcitry-blog` 的远端 `main` 是 production 发布入口；推送站点 `main` 即发起生产发布，包含同一提交中的 Convex schema/functions 与 Clerk 客户端生产配置，不能把随手提交、推送当作保存进度。只有完成本地功能验收、类型检查、权限测试、构建验证和脱敏检查后，才允许提交并推送 `main`；配置缺失或真实登录链路未验收时，保留本地改动，不推送。主题改动先推送主题仓库，再更新本站固定来源与 lockfile。Blog 内容仓库可以继续独立、随时提交 `main`，不要求同步提交站点代码。
- 本站是开源仓库。真实环境配置只能保存在 Git 忽略的 `.env.local`、`.env.production.local`、`.dev.vars` 等本地文件，或 Cloudflare / Convex 的环境设置中；Git 中只保留无真实值的 `.env.example`。Secret Key、Deploy Key、访问令牌、凭据、本机绝对路径、私有内容、生成产物和安装后的商业组件源码不得入 Git。即使 Publishable Key 允许进入客户端产物，也通过环境变量注入，不硬编码进源码。提交前运行 `npm run check:public` 并人工 review diff；该模式检查不能替代人工脱敏。
- 读者功能采用静态 Astro + React Client Island + Clerk + Convex，仍只有一个 Cloudflare Worker；第一版只做个人收藏、阅读进度和私有笔记，评论继续使用既有 Giscus。Clerk 开发与生产实例、Convex development 与 production deployment 分离。`PUBLIC_CLERK_PUBLISHABLE_KEY` 和 `PUBLIC_CONVEX_URL` 属于构建时公开配置；`CONVEX_DEPLOY_KEY` 仅提供给部署步骤，`CLERK_JWT_ISSUER_DOMAIN` 分别配置在 Convex 两个环境。当前路线不需要在 Worker 配置 `CLERK_SECRET_KEY`。生产后端和前端发布不具备跨平台原子性，schema/API 变更必须兼容仍在线的前端，发布后核验真实登录与私有数据隔离。
- Astro 的 Giscus 配置与页面适用条件位于 `src/layouts/BookLayout.astro`；以下评论规则同样约束 Astro，提及的旧 Hugo 模板路径均位于备份分支，不属于当前 `main` 的开发入口。

## Giscus 评论

- Giscus 必须位于页脚前后篇导航之后，并保持 `data-mapping="pathname"`，除非已审计的迁移明确改变它。Astro 通过 `src/layouts/BookLayout.astro` 的 `comments` 插槽接入；备份分支中的旧 Hugo 对应 `layouts/partials/docs/inject/footer.html`。
- 仅对独立内容页启用评论：Astro 必须保留 `page.kind === 'page'` 条件，当前适用类型为 `docs`、`posts`、`about`、`weekly`、`links`；Hugo 对应 `.IsPage`。分区、分类和标签索引页不得启用评论，例如 `/docs/Apple/` 的 pathname 前缀可能模糊匹配到子文章的 Discussion。
- 现有 GitHub Discussions 保留旧页面标题并包含 Giscus pathname term。该 term 是客户端 `location.pathname.substring(1)`：没有开头 `/`，保留 URL 百分号编码和结尾 `/`；根页面使用 `index`。
- 页面标题变化但最终 pathname term 不变时，验证渲染结果，通常无需修改 Discussion。slug、permalink、目录或分区变化时，先更新现有 Discussion 标题，保留旧 term 和最终 term，再发布页面。
- 审计和远端更新使用 Blog 内容仓库内的 `skills/giscus-discussion-compatibility/SKILL.md`（根目录由 `BLOG_DIR` 指定）。优先使用 GitHub MCP；仅在形成可审计的映射计划后，才回退到已认证的 GitHub GraphQL。映射维护期间不得创建或删除 Discussion，也不得修改其正文、分类、状态、评论或 reaction。
- URL alias 和重定向与 Giscus 匹配相互独立。除非用户要求保留历史链接，不要仅为评论迁移添加它们。

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
