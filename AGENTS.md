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
- 首次检出使用 `npm run setup`（执行 `npm ci`），直接安装 npm 上准确版本的 `@tcitry/astro-book` 与其他锁定依赖；不再检出主题源码或生成本地 tarball。主题在独立公开仓库维护，使用公开导出，不把主题实现复制到本站。
- `BLOG_DIR` 是只读内容源。私有内容、生成文件、凭据和安装后的商业组件源码不得进入 Git。React / HeroUI Pro demo 包装组件属于本站，不属于公开主题。
- 主题默认使用 Astro 自带的 Shiki 与小型复制功能；本站继续通过关闭与替换接口使用 HeroUI Pro CodeBlock。不得因主题简化而把本站代码块改回主题默认展示。
- 全站正文宽度以 posts 文章详情页为统一基准。Archives、Tags、Categories、Timeline、Portfolio、Links 等索引或业务页面不单独启用宽页布局；没有右侧目录时也不扩大正文列。Weekly 列表及分页是用户明确指定的例外：不保留右侧 TOC 空白，卡片在足够宽的桌面内容区域显示 4 列，较窄区域依次为 2 列、1 列；单篇 Weekly 正文继续使用统一文章宽度。调整后核对桌面实际宽度与移动端溢出。
- Posts 的“相关阅读”属于文末推荐，不加入桌面或移动端文章 TOC；文章目录只展示正文结构。
- Weekly 列表每页显示 40 期，桌面 4 列时每页 10 行，使用 HeroUI Pagination，保留可在无 JavaScript 时导航的真实页面链接；首页为 `/weekly/`，后续页使用 `/weekly/page/<页码>/`，各页继续按日期倒序排列。
- 侧栏搜索使用明确的 Command 触发按钮，与外观菜单并排放在品牌下方。按 HeroUI design taste 与站点中性色统一尺寸、对齐和交互；外观保留跟随系统、浅色和深色三种模式，图标按钮提供 Tooltip、可访问名称与当前选中状态。
- 除文章页内评论与收藏操作外，登录认证、AI 对话、个人内容、咨询、会员及账户操作统一从右下圆圈按钮打开的右侧面板进入。圆圈入口使用对话气泡类图标，不使用 sparkle / 星芒图标。导航和正文不再提供“我的阅读”、博客助手或其他独立账户服务入口。`/chat/` 与 `/me/` 只是尚未上线的开发页面，直接删除，不保留兼容跳转、别名、说明页或 sitemap 条目，不人为加入历史 URL 基线。登录完成后返回当前页面并保留面板体验；评论继续使用文章页内入口。侧栏边缘仅保留展开／收起把手，两种状态采用相同尺寸与点击范围；桌面收起把手位于左侧分割线外，全屏手机面板放在屏幕内侧。不提供固定侧栏按钮或跨页固定偏好。当前文章收藏位于文末评论数量行，紧邻文章喜欢按钮，以空心／实心书签表示状态；未登录点击打开同一 Clerk 登录，登录后才写入 Convex。跨页面默认收起，忽略已停用的旧固定缓存；同页刷新或登录回调仍可恢复当前板块与展开状态。手动关闭清除本次展开状态，不在后续页面自动展开。收藏列表不重复提供当前文章按钮；收起时在页面右侧边缘中部提供展开把手，复用同一面板并保留当前板块。保留 Esc 关闭，关闭后焦点返回实际使用的圆圈或边缘入口。
- 博客助手的 AI Chat 侧边栏样式参考用户提供的 HeroUI Agents demos，使用现有 HeroUI Pro 聊天组件，保持紧凑的单行顶部栏、中性背景与用户气泡、底部圆角输入框和清楚的文章出处。操作入口只展示已实现的能力，不因参考图包含附件、模型选择或语音控件就添加无效按钮。
- 全站滚动条不预留轨道空间；正文、导航、助手面板、输入框和浮层使用覆盖内容的浮动滚动条，仅在滚动期间显示，停止后淡出，保持原生滚轮、触摸、键盘滚动与拖动能力。
- AI 会话标题须有清楚的文字层级，长标题截断；新对话用带可访问名称和 Tooltip 的加号按钮。历史列表以浮层展示，不挤占消息和输入框空间；历史打开时首次 Esc 只关闭历史。
- 空正文栏目入口由 `scripts/site-pages.mjs` 维护，Blog 不再需要 `archives.md`、`ghstar.md`、`modified.md`、`portfolio.md`、`timeline.md` 占位；栏目 URL 与既有元数据继续保持兼容。
- 修改主题或渲染后，运行站点 build、check、tests 和 verify；生产验收使用对应的 production 命令。保持旧 URL 基线和评论 canonical pathname。
- 生产发布使用独立检出、独立依赖与缓存、独立 `dist/`，内容固定到已审查提交。不得从其他任务仍可能构建的共享工作区发布；`verify:release` 校验生产产物并记录来源与哈希，`deploy:verified` 只上传该份已验收产物；Wrangler 上传期间不能重建或改写资产目录。发现产物被并行改写时，中止上传，确认线上版本，再从独立目录重建、复验和发布。
- `tcitry-blog` 的远端 `main` 是 production 发布入口；推送站点 `main` 即发起生产发布，包含同一提交中的 Convex schema/functions 与 Clerk 客户端生产配置，不能把随手提交、推送当作保存进度。只有完成本地功能验收、类型检查、权限测试、构建验证和脱敏检查后，才允许提交并推送 `main`；配置缺失或真实登录链路未验收时，保留本地改动，不推送。主题改动先在主题仓库发布 npm 版本，再更新本站准确依赖版本与 lockfile。Blog 内容仓库可以继续独立、随时提交 `main`，不要求同步提交站点代码。
- 本站是开源仓库。真实环境配置只能保存在 Git 忽略的 `.env.local`、`.env.production.local`、`.dev.vars` 等本地文件，或 Cloudflare / Convex 的环境设置中；Git 中只保留无真实值的 `.env.example`。Secret Key、Deploy Key、访问令牌、凭据、本机绝对路径、私有内容、生成产物和安装后的商业组件源码不得入 Git。即使 Publishable Key 允许进入客户端产物，也通过环境变量注入，不硬编码进源码。提交前运行 `npm run check:public` 并人工 review diff；该模式检查不能替代人工脱敏。
- 读者功能采用静态 Astro + React Client Island + Clerk + Convex，仍只有一个 Cloudflare Worker；「我的」排在侧栏第一项，并作为没有恢复记录时的默认页面；个人功能集中在「我的」内，提供收藏、喜欢和本人评论三个分类；不提供阅读进度、继续阅读或私有笔记，也不自动记录进度。助手只使用 Convex Agent；旧 Worker `/api/chat`、检索桥和旧前端组件已经删除，Worker 不校验 Clerk session。Clerk 开发与生产实例、Convex development 与 production deployment 分离。`PUBLIC_CLERK_PUBLISHABLE_KEY` 和 `PUBLIC_CONVEX_URL` 属于构建时公开配置；`CONVEX_DEPLOY_KEY` 仅提供给部署步骤。Convex 两个环境分别配置各自的 `CLERK_FRONTEND_API_URL`，名称遵循 Clerk 当前集成指南。启用 Clerk Convex integration 后使用 audience 为 `convex` 的 session token，无需另建 JWT template；Convex 仍须配置可信 issuer，并保留 `applicationID: "convex"` 校验 audience。生产后端和前端发布不具备跨平台原子性，schema/API 变更必须兼容仍在线的前端，发布后核验真实登录与私有数据隔离。
- Astro 的评论入口与页面适用条件位于 `src/layouts/BookLayout.astro`，按下文 Convex 评论规则维护。旧 Hugo / Giscus 实现仅作为历史迁移参考。

## Clerk、会员与会话（2026-09-09 用户确认）

- 站内统一使用 Clerk 登录；会员 Billing 使用 Clerk Billing，价格、周期和套餐内容从 Clerk 配置读取，不在前端编造价格或服务承诺。Convex 在咨询实际写入的 mutation 中，从已验证身份的 Clerk v2 session `pla` claim 精确匹配包含个人 scope（`u`、`ou` 或 `uo`）且 slug 等于 `CLERK_PRO_PLAN_SLUG` 的 Pro 套餐；仅组织 scope `o` 的套餐不能冒充个人套餐，未知 scope、缺失或无效 claim 均不授予 Pro 权限。不能信任浏览器参数提交的 claims、`isPro`、角色或用户 ID。权益变化随短期 token 刷新生效；JWT `exp` 不代表订阅到期日，账期详情由 Clerk 账户组件呈现。
- AI 会话与历史记录使用 Convex Agent Component；公开文章复用既有 Cloudflare AI Search `tcitry-blog-search`（全小写），实例继续关联既有 AI Gateway `tcitry-blog-chat`，不创建第二套资源。新 Agent 对话通过公共 `/chat/completions`，回答模型默认继承实例设置，不由 Convex 固定旧 Qwen 模型或直接指定 Gateway。引用必须保留当前已发布文章的 key、canonical URL 与 content hash 校验；私人收藏、咨询、评论和会话不进入公开文章索引。此次运行时迁移的完成度以本轮代码及真实验收为准，不因规则更新就认定已接通或发布。
- AI Search 是免登录的搜索功能，浏览器通过 `PUBLIC_AI_SEARCH_URL` 调用既有实例的公共 `/search`；登录后的免费 AI Chat 由 Convex 的 `AI_SEARCH_PUBLIC_URL` 指定同一公共实例，不能要求 Pro。Pro 权限只用于真人咨询的新留言。公开 Cloudflare endpoint 自身不具备 Clerk 鉴权，应用内 AI 对话仍由 Convex 校验身份并隔离会话。
- 开发与生产共用上述唯一 AI Search 实例及其 AI Gateway，不为测试创建第二套资源；Clerk 与 Convex 的环境隔离规则仍保持。AI Search 支持已激活的自定义 HTTPS 域名，前端与对应 Convex 必须配置同一 hostname，真实地址只放 Git 忽略文件或平台设置。端点只能来自可信部署配置，不接受用户输入；保留路径、凭据、IP/本地主机、重定向及文章 key/hash 校验。Gateway 自定义域名用于直接 Gateway 请求，不能替代 Search 的 `/search` 或 `/chat/completions`；当前 Convex 不直接配置 Gateway hostname。
- Convex 对话运行时只需要 `AI_SEARCH_PUBLIC_URL`，不需要 `BLOG_RETRIEVAL_URL`、`RAG_BRIDGE_SECRET`、`CLOUDFLARE_ACCOUNT_ID` 或 `CLOUDFLARE_API_TOKEN`，也不启动检索桥或 tunnel。Cloudflare Account ID 与 API token 仍用于本地/CI 文章索引同步和部署，不能全局删除；不得重新引入 Worker `/api/chat` 或服务端检索桥。真实 endpoint 只放被忽略的环境文件或平台配置，不写入 Git 示例。
- Pro 真人咨询采用站内异步私聊：用户留言、作者本人回复。访问仅限所属用户与明确配置的作者身份；作者角色由后端校验，不能由客户端指定。UI 明确区分 AI 对话与真人回复。订阅失效后保留用户自己的历史读取，新付费留言须重新核验权益。
- 读者发起咨询、继续留言和作者回复均支持 Convex File Storage 图片附件，提供上传预览、移除、失败重试和点开放大。文件上传归属与实际读取均在服务端鉴权，仅会话双方可访问；不返回可绕过登录的永久公开文件链接，不进入评论附件查询或公开 AI Search。
- 顶部 Tabs 为「我的」「AI 对话」「咨询」；已验证的作者额外显示「管理」。「消息」使用头像左侧的铃铛入口与未读圆点，点击展示现有消息列表，不占用 Tabs。「我的」下分收藏、喜欢、评论，展示本人收藏、喜欢的文章及自己发表的评论和回复。「消息」向已登录读者提供收到的评论回复与咨询回复通知，点击定位原评论或咨询；「管理」专门收取和回复读者咨询。「咨询」始终展示当前账户自己发起的咨询。后端分别校验通知收件人、本人列表/发送与作者收件箱/回复权限。账号或 session 切换时清空私人列表、选中会话和草稿，普通账户不能恢复作者视图或读取收件箱。
- 不保留单独「会员」tab。会员状态与订阅管理合并到现有 Clerk 头像菜单，「管理订阅」直接打开 Clerk Billing；不常驻套餐卡、重复状态标题、刷新按钮或未实现的权益说明。状态不可用时明确显示错误并提供重试，不能误显示成免费账户。
- 用户明确要求的 Google One Tap 是圆圈登录入口之外的提示式登录方式；复用同一 Clerk 账户，仅在生产配置且未登录时展示，每页只挂载一次，登录后回当前页面，不为此创建独立认证服务。
- 「咨询」进入时自动核验权益，同样不展示常驻「刷新会员状态」按钮；读取失败时才提供重试，发送时仍须后端鉴权。
- 所有私人 React 数据缓存按 Clerk 用户和 session 隔离，退出或切换账户同步丢弃旧 client，禁止显示上一账户的数据。当前认证与 Pro 授权使用已验证 session claims，不要求配置 Clerk Secret Key，也不通过 Clerk Backend API 查询订阅。模型与检索密钥仅配置在实际调用它们的平台环境，不进入浏览器。

## Convex 评论（2026-09-09 用户确认）

- 评论使用 Convex，放弃 Giscus。未登录可查看文章的评论总数、喜欢总数和简短登录提示；公开查询只返回聚合数字。登录后才显示实际评论列表和输入框，禁止匿名发布；所有正文、回复、图片及个人喜欢状态的查询和写入均须后端鉴权，不能只隐藏 UI。每条新评论绑定已验证 Clerk 账户，不接受客户端指定归属。
- 评论位于页脚前后篇导航之后，保留 `page.kind === 'page'` 条件，仅对 `docs`、`posts`、`about`、`weekly`、`links` 独立内容页启用。分区、分类、标签和业务索引页不启用。
- 评论使用 canonical pathname 关联文章。路径变动仍需审计已有评论关联；页面标题不作为评论主键。评论直接使用 Clerk 账户中的用户名，不再要求另填公开昵称；用户在 Clerk 账户设置中维护用户名，不使用邮箱或私有身份 ID 作显示兜底。
- 文章与每条评论均支持「喜欢」，使用心形图标、数量与明确的选中状态；登录后可以喜欢或取消，幂等写入并按账户去重。未登录不开放写入。
- 评论支持回复与连续讨论，清楚展示回复对象和层级；删除父评论时清除原正文及附件，保留讨论链的删除占位。图片通过 Convex 存储，上传、附件归属和读取在服务端校验；提供上传预览、移除、失败重试和点开放大，失败保留文字草稿。不得把评论或附件加入公开 AI Search 语料。
- 历史 GitHub Discussions 保留原状。用户要求待新功能与数据结构稳定后单独做历史评论迁移，当前不导入、不删除、不改写。后续迁移保留原公开作者、时间、回复关系与来源标记，不按同名认领到 Clerk 账户。
- `BLOG_DIR` 中的旧 Giscus compatibility Skill 只用于历史映射审计；其保留 Giscus 或改 Discussion 标题的旧流程不适用于新评论系统。
- 规则表示产品方向，完成度仍以本地、真实账户和生产验收区分，不把本地实现视为上线。

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
