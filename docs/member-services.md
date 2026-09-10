# 账户、AI 对话与会员咨询

2026-09-10：本轮在现有 Astro + Clerk + Convex + 单 Cloudflare Worker 上继续开发。本文记录实现边界与联调入口，不代表已经发布生产版本。

## 当前需求核对（2026-09-10）

本节以最终需求为准；下文带日期的过程记录不能用来证明后来改过的实现已经完成真实验收。

| 范围 | 当前完成度 |
| --- | --- |
| 圆圈统一入口、删除开发页面、边缘收起与展开 | 已实现并通过本地 UI 验证；`/chat/`、`/me/` 无兼容页或跳转 |
| 我的：收藏、喜欢、本人评论与回复 | 已实现，真实账户读取和分类切换通过；阅读进度与笔记已移除 |
| 读者消息与作者管理分离 | 已实现；消息改为头像左侧铃铛，未读圆点按收件人索引实时查询。隔离测试覆盖通知生成、已读、原文/咨询定位和作者权限；真实双账户收发待验收 |
| 评论权限、回复讨论、文章与评论喜欢 | 已实现，后端身份与跨账户测试通过；匿名仅查聚合数量 |
| 评论和咨询双方图片 | 已实现 Convex 存储、认证读取、预览、移除、重试和放大；development 真实登录后独立咨询附件上传、读取字节一致、匿名401和测试附件清理通过；双账户咨询收发及附件读取待验收 |
| Clerk 用户名取代公开昵称 | 已实现；需核验实际 Clerk session 的用户名 claim 后，再验收新版真实发布，不能借用早期昵称表单的发布记录 |
| 咨询列表/详情、AI 标题/加号/历史浮层、Search 样式 | 已实现并通过本地交互与响应式验证；Search 保持 14px、灰色、400 字重 |
| Clerk 统一身份、会员和作者识别 | development 真实登录、Pro 与作者识别通过；代码不依赖 Clerk Secret Key |
| 头像会员状态与直接打开 Billing | 已实现，真实 Billing 初始页面通过；付款、升级/取消及权益变化后的回流待验收 |
| Google One Tap | production 条件下的组件代码及隔离测试完成；尚未发布，实际 Google 登录待生产域名验收 |
| 左侧匿名 AI Search | public `/search` 已接入，真实查询和原文跳转通过；临时故障可回退全文搜索，远端语料未全量完成 |
| 登录后免费 AI Chat | development 已通过公共 `/chat/completions` 的真实首问、追问、刷新恢复及旧失败会话重试，每轮来源与持久化状态均核验。旧检索桥和 Cloudflare 模型凭据已从该 development 移除；部分上游查询仍报错，生产未发布 |
| HeroUI Pro Uber 主题 | 用户要求切换；当前安装及 npm latest 均为 `1.0.0-beta.8`，包内仅含 brutalism / glass / mouve，尚无 uber。待确认用户所见主题来源；未写入不可解析的 import |
| 历史评论迁移 | 按用户要求暂缓，原 GitHub Discussions 未改动 |
| 生产发布 | 本轮未发布；开发环境验证不能代替生产验收 |

最新验收补充：类型检查、交互回归和预览构建通过；最终全站 URL 留存校验发现 `/docs/Cloudflare/wrangler-%E5%AE%89%E8%A3%85%E6%96%B9%E5%BC%8F/` 缺失，当前内容页已使用 `/docs/Cloudflare/wrangler-install/`。该内容来自正在进行的另一内容分支，本轮未切换分支或改写该文档；发布前仍须补齐旧 URL 兼容并重新运行 `verify`。

AI Search 导入、错误数量与暂停范围见 [实际执行记录](ai-search.md#本次实际执行结果2026-09-10)。`CLERK_FRONTEND_API_URL` 仍用于配置可信 issuer；“移除 Clerk Secret Key”的既有实测记录指 Convex development，本机忽略文件中尚有未使用的旧字段，不代表所有配置位置均已清理。

本次复核补齐两处交互边界：登录后的圆圈只裁切头像子层，避免悬浮提示一起被裁掉；评论数量与首次列表查询将原有的 15 秒后刷新页面兜底改为局部重试，重新订阅时保留文字、图片预览和表单节点，迟到数据自动恢复。圆圈在 1440 / 390 / 320px、登录前后、鼠标与键盘下的显示验证通过；评论定向及完整 services 回归覆盖超时、重试、迟到恢复和账户切换，全程没有真实发布评论、咨询或上传附件。补漏后类型检查、构建与产物校验通过。

## 本轮交互与上传修复（2026-09-10）

- 评论上传入口收敛为 40px 纯图标按钮，文件限制进入 Tooltip，选图后显示数量。修复 Tooltip 的 portal 容器被表单网格当作额外一行、悬停时高度增加 14px 的问题；真实博客样式下，320 / 416 / 772px 的明暗主题逐帧验证表单、按钮与页面滚动位置不变。评论原始 HTML 不再提前显示加载文字，只在真正开始按需挂载时显示加载状态。
- 搜索转对话入口改为整行的「用这个问题问 AI」，右侧显示「登录后免费」。点击只带入当前草稿，保留已有草稿的明确替换选择，不自动发送；窄屏、键盘及会话切换隔离回归通过。
- 「我的」二级分类居中；顶部文字 14px，铃铛和头像均为 32px。「消息」从 Tabs 移到头像左侧，保留未读圆点、提示和选中状态；`notifications.hasUnread` 使用当前收件人及 `readAt` 索引最多读取一条，development 已部署。铃铛在 320、375、640、757、916、1016px 及账号切换、已读更新、键盘操作下通过验证。
- 咨询详情读取状态前不挂载输入、上传或发送控件；已结束咨询保持标题与消息位置，读取失败提供局部重试。读者及作者延迟查询、已结束、可回复、错误和切换草稿的隔离回归通过。
- 全站隐藏占用布局的原生轨道，使用不参与布局的浮动滑块；保留原生滚轮、触摸、键盘与指针拖动。仅滚动时显示，停止约 650ms 后淡出并移除。正文、嵌套区域、文本框、横向代码块和原生弹窗均验证无内容尺寸变化，页面宽度 320–1440px 无预留 gutter。
- 实际咨询图片失败发生在 CORS 预检：development 允许来源遗漏当前预览地址，OPTIONS 为 403，尚未进入上传。仅补齐当前精确开发 origin，未放开通配符或更改生产配置；实际当前 origin OPTIONS 204、陌生 origin 403、匿名 POST 401。上传错误改为受控分类提示，父表单不再重复报错，失败继续保留草稿与预览。
- 使用临时本地 upload-only 页面，复用正常 Clerk SDK 会话与产品上传 helper，只上传一张合成 PNG。真实 Convex 存储和受保护读取字节比对成功，匿名读取返回 401；随后通过所属人 `discard` 清理该测试文件。未发送任何咨询或评论，临时验收页面已移除。此证据不代替双账户实际收发验收。

该交互修复阶段检查：247 项 Node 测试、85 项 Convex 测试、完整 services 浏览器回归及浮动滚动条专项通过，类型检查 0 错误 / 0 警告；构建和产物验证通过。真实页面确认顶部 14px、头像和铃铛 32px、「我的」分类中点与容器中点重合，面板右缘与视口右缘一致。未发布生产。

## 功能与数据

AI 对话、个人收藏列表、咨询和账户管理统一从右下圆圈进入，会员状态与订阅管理并入顶部头像菜单，不保留单独会员 tab。评论及当前文章收藏保留文章页内入口；生产环境另按用户要求提供 Google One Tap 提示式登录，复用同一 Clerk 账户。导航与正文不提供独立账户服务页面；尚未上线的 `/chat/`、`/me/` 开发页面已经删除，不保留兼容跳转或说明页。登录后返回当前文章。

| 入口 | 数据与权限 |
| --- | --- |
| AI Search | 左侧搜索免登录，使用 Cloudflare public Search；索引覆盖与配置见 [AI Search](ai-search.md) |
| AI 对话 | Clerk 登录后免费使用；Convex Agent 保存线程、消息与生成状态，用户只能读取自己的会话 |
| 咨询 | 始终展示当前账户自己发起的咨询；Pro 会员给作者异步留言，历史读取不随订阅失效而消失 |
| 我的 | 收藏、喜欢、评论三个分类；只读取本人收藏和喜欢的文章、自己发表的评论与回复；不记录阅读进度，不提供笔记 |
| 消息 | 读者收到的评论回复与咨询回复通知，点击打开原评论或咨询；不回填历史回复 |
| 管理 | 仅后端核验的作者可见，收取并回复读者咨询，普通账户不能查询收件箱 |
| 头像菜单 | 显示已核验会员状态与订阅管理入口，直接打开 Clerk Billing；无单独会员 tab，状态错误时可重试 |
| 文章评论 | 未登录可见评论总数与文章喜欢总数；登录后显示输入框、正文、回复和图片，使用 Clerk 用户名，无额外昵称输入 |
| 喜欢 | 文章和评论均支持心形图标及数量；登录后按账户幂等喜欢或取消 |

评论保留在 `BookLayout` 的页脚前后篇导航之后，只用于独立的 docs、posts、about、weekly、links 内容页。Giscus 已从新页面实现中移除。历史 GitHub Discussions 保持原状；按照用户要求，等功能和 Convex schema 稳定后再做专门迁移，本轮不导入、不删除、不改写。

AI 对话使用 `@convex-dev/agent`，以 mutation 保存问题和调度任务，后台 action 检索并流式生成；客户端订阅持久消息。浏览器不提交 assistant 历史作为可信记录。每条业务会话关联一个 Agent thread，来源、状态与请求去重记录单独保存；停止、失败与超时均有持久状态。

生成上下文只采用同一账户、同一会话的完整已完成问答：扫描最近 32 个运行记录，最多保留 4 轮；失败、取消和不完整回答继续显示在历史中，但不传给模型。追问的预检检索以最近一轮完整问答的用户问题作为上文，公共 Chat 的最后一条用户输入复用这个检索查询，存储的原始问题不改写。两次检索均明确使用 vector 参数，Chat 仍只能检索预检通过的 content hash，并在输出任何回答文字前验证来源的 key、hash、canonical URL 与 source kind。

会话顶部以单行标题显示当前主题，长标题截断；加号用于新对话，提供可访问名称和 Tooltip。历史使用面板内的 Popover 与单选列表，覆盖在现有内容上，不改变消息和输入框的布局；选择后收起，首次 Esc 只关闭历史。

作者「管理」与个人「咨询」使用独立的列表和发送接口：`listThreads` / `send` 只操作本人的咨询，`listInbox` / `reply` 只允许配置的作者调用。作者在自己的「咨询」里留言仍按会员消息处理、核验 Pro 权益；在「管理」里回复按作者消息处理。回复内容不发给 AI。导航权限也使用后端核验结果，切换账号或 session 会销毁原客户端及作者视图、选中会话和草稿。

进入「咨询」会自动核验会员状态，不常驻「刷新会员状态」按钮；读取失败时提供「重试」。新增或继续留言仍由后端在实际写入时检查身份和权益。

咨询发起、后续留言和作者回复均支持图片：每条最多 4 张、每张不超过 5 MB，格式为 JPEG、PNG、WebP 或 GIF。允许仅图片消息，新咨询仍需填写主题。发送前预览和移除，失败保留草稿与已成功上传的附件，重试不重复上传；发送后支持点开放大。咨询与评论复用图片组件和 Convex File Storage，但附件用途与归属不可互换。图片通过带 Clerk JWT 的 HTTP endpoint 读取，每次检查评论登录权限或咨询双方身份，返回 private/no-store 响应，不向客户端提供永久公开 Storage URL。未绑定的上传 24 小时后清理；私人附件不进入 AI Search。

Cloudflare AI Search 继续使用既有实例 `tcitry-blog-search`（全小写）、公开文章语料和发布流程。浏览器通过 `PUBLIC_AI_SEARCH_URL` 匿名调用 `/search`；本轮 Convex Agent 改用其 deployment 中的 `AI_SEARCH_PUBLIC_URL` 调用同一实例的公共 `/chat/completions`，模型默认继承实例设置，不再固定旧 Qwen 模型或直接指定 Gateway。实例仍关联既有 `tcitry-blog-chat`，不新建资源。Convex 继续校验登录身份、会话归属和当前公开引用的 key、canonical URL、content hash；私人收藏、咨询、评论和 AI 会话不加入公开文章索引。旧 Worker `/api/chat`、受保护检索桥及旧前端组件已经删除，助手只使用 Convex。新调用链已在 development 通过真实首问、追问、核验引用、刷新恢复及旧失败会话重试；生产尚未部署，剩余上游限制见下文验收记录。

收藏功能已按用户要求收敛，前端不再监听滚动或离页事件保存进度，后端移除进度和笔记接口。旧存储表暂保留且不再读写；本次不删除既有数据。收藏位于「我的」的二级分类，不重复展示「你的收藏」标题。当前文章收藏移至文末评论数量行，与文章喜欢按钮并列，以空心／实心书签表示状态；未登录点击进入同一 Clerk 登录。收藏列表不重复提供当前文章操作。不提供固定按钮，旧固定缓存不再生效；跨页面默认收起，同页刷新或登录回调可恢复展开状态与当前板块，手动关闭后保持收起。边缘仅保留展开／收起把手，尺寸与点击范围一致，桌面位于分隔线外、全屏手机面板放在屏幕内；收起后可从右侧边缘中部的展开把手回到同一板块，原圆圈入口仍可使用。支持点击、键盘和 Esc，关闭后焦点返回实际打开面板的入口。

本次收敛已同步到 Convex development：204 项 Node 测试、51 项 Convex 测试、类型检查、构建及产物校验通过。收藏 fixture 验证添加、取消、失败重试、分页、账户隔离，以及滚动和离页后不自动写入；真实本地页面验证原有收藏仍可读取。桌面和手机验证收藏入口、分割线把手、提示位置、点击与 Esc 关闭及焦点恢复，未发布生产。

后续作者入口拆分已同步到同一 development：204 项 Node 测试、53 项 Convex 测试通过；类型检查 0 errors / 0 warnings，构建与产物校验通过。服务 fixture 验证作者收件箱与本人咨询分别读取、作者回复、跨账户和 session 清空、普通用户无法恢复作者视图，以及 320–973px 顶部导航。会员页和 AI 历史浮层通过状态错误处理、布局稳定、选择关闭及 Esc 优先级验证。真实登录页面已识别作者 tab 和 Pro 状态，订阅入口可打开带 Billing 入口的 Clerk 账户界面；这不代表真实付款或 AI 生成已验收。

## Billing 与作者身份

Pro 授权读取 Convex 已验证身份中的 Clerk v2 session claims，不再调用 Clerk Backend API 查询订阅。仅接受 `pla` 中包含个人 scope 的套餐，slug 必须与 `CLERK_PRO_PLAN_SLUG` 精确匹配；有效 scope 为 `u`、`ou` 或 `uo`，例如 `u:pro_user`。仅组织 scope `o` 的套餐不能冒充个人套餐；未知 scope、Free 套餐、相似名称、缺失或无效 claim 均不能授予 Pro 权限。缺少套餐配置同样拒绝新增付费留言。每次新开或发送咨询都在实际写入的 mutation 内核验身份与权益；已经成功的同一请求重试不重复创建消息。

Convex 使用 `ConvexProviderWithClerk`：Clerk 启用 Convex integration 后使用 audience 为 `convex` 的 session token，无需另建 JWT template。后端通过 `CLERK_FRONTEND_API_URL` 指定可信 issuer，并保持 `applicationID: "convex"` 校验 audience。只信任 Convex 验证后的 claims，不依赖前端 `has()` 或浏览器参数中的 `pla`、`isPro`、owner、admin。当前认证与 Pro 授权均不需要 `CLERK_SECRET_KEY`。`CONSULTATION_ADMIN_TOKEN_IDENTIFIER` 必须是指定作者在当前 Clerk issuer 下的完整 `tokenIdentifier`；姓名、邮箱、显示昵称或单独 subject 都不作为全局管理身份。

权益变化随 Clerk 短期 session token 的刷新生效；写入时重新读取 claims 不等于实时查询 Clerk 的订阅状态。后端不会根据 JWT 的 `exp` 推导会员到期日，`validUntil` 返回 `null`。订阅账期、续订与取消等详情由 Clerk 账户组件呈现，不自行推算剩余有效期。自定义 JWT template 不包含与 session 关联的 `pla`、`fea`，不能替代此处的 session token；缺少 claims 时拒绝授予 Pro 权限，也不能据此确认用户实际订阅了 Free 套餐。

套餐价格、周期、退款与服务承诺应先在 Clerk Billing 及实际服务规则中明确。代码不生成虚构价格，不承诺无限咨询或固定回复时限；生产收款前必须用实际测试付款和作者账户验收。

## 一次性配置

现有 `PUBLIC_CLERK_PUBLISHABLE_KEY`、`PUBLIC_CONVEX_URL`、Clerk Convex integration 和 `CLERK_FRONTEND_API_URL` 继续按 [持续部署文档](continuous-deployment.md) 配置。development 与 production 必须分别设置，不能把测试实例的用户或权益带进生产。

### 评论用户名与图片

Clerk 默认 session token 不包含用户名。两个实例分别在 **Sessions → Customize session token → Claims editor** 中保留原有字段，并加入：

```json
{
  "preferred_username": "{{user.username}}"
}
```

该字段随已签名 session 传给 Convex 的 `identity.preferredUsername`；评论不接受浏览器传入的作者名。用户在 Clerk 账户中维护 username，缺少已验证用户名时拒绝发布并保留草稿，不使用邮箱或私有 ID 兜底。这不需要 Clerk Secret Key，也不需要另建 JWT template。参见 [Clerk 自定义 session tokens](https://clerk.com/docs/guides/sessions/customize-session-tokens)。

图片 HTTP endpoint 使用对应部署的 `.convex.site` 地址，由标准 `PUBLIC_CONVEX_URL` 推导。Convex 中的 `CHAT_ALLOWED_ORIGINS` 须包含实际前端 origin（本地开发端口也须精确匹配）；前端仅向受信任的图片服务发送 Clerk JWT。

### Google One Tap

用户已确认生产实例配置 Google SSO；站点通过已有 `@clerk/react` 的 `GoogleOneTap` 增加快捷登录。`BookLayout` 只挂载一个专用 client-only island，复用 `BlogClerkProvider`，不会在评论、头像和助手等每个 Provider 中重复渲染。仅 `PUBLIC_SITE_ENV=production` 且使用 `pk_live_` 时启用，Clerk 加载完成且用户未登录才显示；普通本地 preview 不触发。登录或注册成功回到发起时的完整页面 URL，继续使用同一 Clerk 账户与 Convex 身份。

生产 Google connection 需启用 custom credentials，Google OAuth 的 Authorized JavaScript origins 需包含实际站点 origin。OAuth Client Secret 留在 Clerk 配置中，不增加浏览器、Worker 或 Convex Secret Key。组件保留官方默认的 FedCM、ITP 支持及点击外部关闭行为；用户关闭后的冷却和浏览器身份设置可能使提示暂不显示，不主动清除这些选择。

本地组件测试只能证明环境、登录状态与回跳参数的行为。实际提示、Google 账户选择与完成登录仍需在生产域名的标准浏览器验收；Clerk 文档提示 Google OAuth 不支持 WebView 登录，不能用 Codex 内嵌浏览器是否弹出作为生产验收结论。代码接入不代表已经发布或完成真实 Google 登录。

依据：[Clerk GoogleOneTap](https://clerk.com/docs/react/reference/components/authentication/google-one-tap)、[Clerk Google social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)（2026-09-09 核验）。

### 服务端配置

| 配置位置 | 变量 | 用途 |
| --- | --- | --- |
| Convex 环境 | `CLERK_PRO_PLAN_SLUG` | 控制台建立并提供咨询权益的个人 Pro 套餐 slug |
| Convex 环境 | `CONSULTATION_ADMIN_TOKEN_IDENTIFIER` | 唯一受信作者身份，用于咨询收件箱和评论管理 |
| 前端构建 | `PUBLIC_AI_SEARCH_URL` | 既有 AI Search Public endpoint origin 或 `/search` URL；浏览器匿名检索 |
| Convex 环境 | `AI_SEARCH_PUBLIC_URL` | 指向同一公开实例，由 Convex Agent 调用 `/chat/completions`；development 已配置并通过真实生成验收，production 的配置与部署本轮未改动 |
| 本地/CI 的索引同步及发布环境 | `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN` | REST 文章同步及部署所需账户与权限；不属于新 Convex 对话运行时 |

密钥不进入 `PUBLIC_` 变量、页面 HTML、客户端包、源码或 Git；两个 AI Search URL 指向公共 endpoint，本身不是密钥，真实值仍按项目规则只放忽略文件或平台设置。当前功能不要求在 Convex、Worker 或本地文件中配置 Clerk Secret Key。可填写的无真实值示例见 [`.env.example`](../.env.example)。写入站点 `.env.local` 并不会自动设置 Convex cloud deployment 的环境变量。

新 Convex 公共对话链路不需要 `BLOG_RETRIEVAL_URL`、`RAG_BRIDGE_SECRET`、`CLOUDFLARE_ACCOUNT_ID` 或 `CLOUDFLARE_API_TOKEN`。这只减少 Convex 运行时配置，不表示应删除本地/CI 的 Cloudflare 凭据；索引同步和部署继续按 [AI Search 同步说明](ai-search.md#认证和-api) 使用现有受限权限。公共端点不替代 Clerk 或 Convex 权限校验，站内对话仍须登录后才能创建、生成和读取。

Clerk Dashboard 中启用个人 Billing，并配置实际计划。头像菜单展示已核验的会员状态，订阅管理调用 Clerk `openUserProfile({__experimental_startPath: "/billing"})`，直接进入实际账单与订阅页面。路径已核对 [Clerk 官方 UserProfile 路由](https://github.com/clerk/javascript/blob/main/packages/ui/src/components/UserProfile/UserProfileRoutes.tsx)；`__experimental_startPath` 是当前 SDK 提供的实验性参数，升级 Clerk 时须回归这条导航。不自行实现支付表单。配置或 claims 不可用时显示错误并提供重试，不将查询失败显示为免费账户，也不伪造订阅、模型结果或作者回复。

新链路直接由 Convex cloud deployment 访问公共 AI Search endpoint，不要求连接开发者机器，也不要求启动本机 bridge 或 tunnel。保持前端 `PUBLIC_AI_SEARCH_URL` 与对应 Convex `AI_SEARCH_PUBLIC_URL` 指向同一实例；development 与 production 的 Clerk/Convex 身份配置继续隔离。

开发与生产共用既有 AI Search 和 AI Gateway。Search endpoint 可使用默认 Cloudflare 域名或已激活的自定义 HTTPS 域名；前端与 Convex 必须使用同一个配置 hostname，生产发布校验不猜测不同域名是否为别名。真实地址保存在 ignored env / 平台设置中。Gateway 自定义域名用于直接 Gateway 请求，当前 Convex 公共 Search/Chat 链路不调用该域名；它与 Search 的自定义域名分别配置。[Search 自定义域名](https://developers.cloudflare.com/ai-search/configuration/retrieval/public-endpoint/custom-domains/)、[Gateway 自定义域名](https://developers.cloudflare.com/ai-gateway/configuration/custom-domains/)

## 侧栏异常恢复

2026-09-10 本地联调确认一次侧栏错误的直接原因：已打开的 preview 页面在重新构建后继续引用上一版动态模块，而 `dist` 已被替换，模块请求失败。该错误来自 React lazy import；不能把它归因于 Convex 断网。原边界会永久替换整棵侧栏且没有关闭、重试入口。

可复用 `ServiceBoundary` 现在区分模块加载失败与一般渲染/查询失败。模块失败不反复重挂已经缓存拒绝结果的 React.lazy，只提供明确的“更新页面”和可选关闭操作；不会自动刷新。其他失败最多自动恢复一次，定时器、恢复联网、返回可见页共享这一次预算，之后保留局部“重试”；手动重试不重置自动预算。错误日志只输出固定类别，不输出原始异常、stack、查询参数或身份。

`ConvexSession` 的默认边界位于 Client/Provider 之外，恢复时重建失败的 client；Clerk user/session key 仍隔离缓存。私有功能可使用更近的边界，减少单一区域失败的影响。Convex 普通网络中断由 SDK 自动重连，与上述被捕获的渲染异常不同。[Convex 查询错误](https://docs.convex.dev/functions/error-handling)、[React 客户端](https://docs.convex.dev/client/react)

## 验收与发布

2026-09-10 较早阶段的公共对话链路验收：新代码已部署到 Convex development。真实 Clerk 登录后的内嵌浏览器页面中，首问 Convex 得到完整回答和一篇经当前引用清单核验的来源；刷新页面后，回答与引用从持久会话恢复。随后追问“它和 Durable Objects 有什么区别？”继续得到完整回答与该轮引用，验证了实际检索、生成、会话恢复和中文上下文追问。

本轮最终复测：上下文修复部署 development 后，新会话首问为 completed、2 个来源、3.424 秒；随后原追问为 completed、2 个来源、7.737 秒。安全日志确认追问的 Search、Chat HTTP 200、来源校验、`[DONE]` 与 Agent 持久化全部完成，没有 action 错误。内嵌浏览器显示完整回答，刷新后两轮回答及各自 2 个引用入口恢复，未出现错误提示。

旧失败会话的原两条失败记录保留；再次提交相同追问后，新增运行在 3.696 秒内 completed，2 个来源、无 error。实际请求只带原成功问答和当前问题，失败轮次没有挤掉原话题。该轮同样通过 HTTP 200、来源核验、`[DONE]` 和持久化，action 没有错误。34 项定向测试与 Convex 类型检查通过；生产未部署。

这次修复针对两个已观察到的问题：早期生成 action 约 13.5 秒时失败，应用 run 却等到 120 秒才显示超时；失败后再问又会把上一条失败的相对追问当作检索上文。现在生成失败先结算应用 run，再进入 Agent SDK 清理；检索与模型上下文仅使用完整成功轮次，存储的原始问题、回答和失败记录保持原样。早期 HTTP 400 的服务错误码未取得，不能宣称其上游根因已消除，也不能把这次成功推广为所有查询持续稳定。

HTTP 400 不能单凭状态归为请求格式错误：官方将 Workers AI 错误 `7019` 及超时 `7030` / `7031` 也归为 400；超出上下文窗口 `7079` 对应 413。[AI Search API 错误码](https://developers.cloudflare.com/ai-search/troubleshooting/api-error-codes/)

当前历史失败未取得服务错误码，保留未确定结论。临时消息角色和字符数诊断已关闭；常规日志仅记录固定阶段、耗时、HTTP 状态、数字错误码和错误中提及的协议字段，不记录问题、回答或原始错误正文。字段被提及不等于它被判定非法；执行阶段也不能替代 `assistantRuns` 中的持久终态，取消竞态须同时核对该状态。

development 已配置 `AI_SEARCH_PUBLIC_URL`，并移除 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`BLOG_RETRIEVAL_URL`、`RAG_BRIDGE_SECRET` 四个旧运行时变量。移除后再次从真实登录页面提问 Convex，仍得到完整回答及来源，确认新运行时不依赖这些旧变量。生产部署及生产环境配置均未改动；本地/CI 的 Cloudflare 索引同步和发布凭据仍按各自用途保留。

较早整体验收记录为 261 项 Node 测试、101 项 Convex 测试通过，类型检查 0 errors / 0 warnings，构建与产物校验通过。新增生产 endpoint 前置校验另以 16 项配置及发布测试验证：目标 Convex 的 `AI_SEARCH_PUBLIC_URL` 必须有效并与封存前端指向同一公共实例，缺失或不一致时在部署前停止，不写入环境变量、不输出凭据。这些测试未操作生产。

仍有实际上游限制：TOTP 及部分问句返回错误 `7073`，不能宣称搜索持续稳定。截至 2026-09-10，Cloudflare Dashboard 为 31 indexed、22 errors、53 total，queued 和 processing 均为 0；索引错误为 capacity / timeout，但没有证据证明这些索引错误与查询 `7073` 是同一个根因。远端尚未覆盖全站公开文章；单次或连续问答通过不代表全量 AI 索引已完成。详见 [AI Search 执行记录](ai-search.md#本次实际执行结果2026-09-10)。One Tap、双账户实际咨询和附件读写、付款及生产验收的待办保持不变。

以下关于旧 Worker 检索桥、固定模型及 Cloudflare token 的带日期记录仅保留问题追踪价值，不再作为新链路的必填配置或完成证明。停止、失败重试、引用版本和跨账户隔离继续由对应权限与流式测试覆盖；不能将浏览器 fixture 当作真实双账户验收。

2026-09-09 旧链路复核记录：development 已部署 `agent` Component，实际会话与用户消息已写入其 `threads`、`messages` 表。当时的开发环境缺少 `BLOG_RETRIEVAL_URL` 和 `RAG_BRIDGE_SECRET`，该次业务运行在约 241ms 后变为 `failed`，未进入检索或流式生成。单独复测旧模型 REST 请求返回 `401 / 10000`，当时尚未通过模型权限验收；不能把登录成功或消息保存成功当作回答生成已通过。这些旧配置不再是本轮公共对话链路的前置条件。

在 Convex Dashboard 选择 development：Data 的根组件中查看 `assistantConversations` 和 `assistantRuns`，检查 `status`、`error` 与 `sources`；切换到 `agent` Component 查看 `threads`、`messages`、`streamingMessages` 和 `streamDeltas`。Settings → Components 可确认组件部署。当前 `assistant:generate` 捕获异常后通过 mutation 保存失败状态，再正常返回，因此 Logs 的函数执行成功不等于业务回答成功，必须同时检查 `assistantRuns`。

当前没有模型列表、前端选模或自动模型发现。本轮新链路默认继承 AI Search 实例的回答模型，不再由 `convex/assistantModel.ts` 固定旧 Qwen 模型或直接传入 Gateway。AI Search 的 embedding 模型承担向量化，与回答模型分别配置。本轮已验证新路径真实生成；本文不据旧代码推断或记录未经请求日志核验的具体回答模型名称。

```sh
npm run convex:codegen
npm run check
npm test
npm run build
npm run verify
npm run test:browser
npm run test:browser:services
```

新功能测试应覆盖匿名和跨账户访问、伪造权益或作者角色、同一请求重试、私聊双向读写、分页、AI 停止/失败/恢复、来源版本过滤，以及匿名评论提示。浏览器 fixture 使用合成身份和数据，只证明组件行为；不能代替实际 Clerk 登录、Clerk Billing 付款、Convex 环境与 AI Search 公共对话请求验收。

2026-09-09 本地验收结果：`check` 通过（0 errors、0 warnings，8 条弃用提示）；204 项 Node 测试与 50 项 Convex 测试全部通过；普通预览构建与 `verify` 通过，保留全部 1,208 个既有 URL，并验证 967 个评论页面及私有目录排除规则。原有阅读、搜索与导航浏览器回归通过；会员服务 fixture 在桌面与手机尺寸下验证了咨询创建、发送、作者回复、关闭，匿名评论不查询数据，登录后安全渲染，以及 AI 历史、新会话、发送、停止、切换面板后的恢复和账户切换隔离。实际本地页面也已确认仅向匿名用户显示评论登录提示，不再加载 Giscus。

后续联调已将本轮函数与 Agent Component 同步到既有 Convex development deployment，并核对前端 Clerk issuer 与开发后端一致。Clerk development 的 Convex integration 原先未启用，导致 token 请求返回 `404 / resource_not_found`；启用后，真实登录账户已成功连接 Convex。已在实际页面验证评论发布、刷新后读取、回复关联和本人删除；本轮创建的两条开发测试评论已清理，再次加载确认为空。另修复页面底部发布按钮被圆圈入口遮挡的问题，为评论区保留入口所需的底部空间。

前一阶段曾用 Clerk Backend API 验证现有 Free/Pro 套餐。当前已改为从 Convex 验证后的 session claims 核验 Pro 权益，移除 Backend API 调用及其 SDK 直接依赖；真实登录账户已通过该方式识别 Pro 状态。Convex development 已切换到 `CLERK_FRONTEND_API_URL`，并核验旧的 `CLERK_JWT_ISSUER_DOMAIN` 与 `CLERK_SECRET_KEY` 均已删除。生产配置未改动，生产发布前须按新变量名完成对应实例配置。该阶段真实付款过程、付费私聊与旧 Agent Gateway 请求尚未通过验收；不能以当时的 Pro 状态、fixture 或凭据配置成功作为这些链路的完成证明。代码尚未推送站点或发布生产版本。

旧链路当时进一步验证 Cloudflare token 为有效 Account token，但模型 REST 请求返回 `401 / 10000`。本机受保护的检索入口已从既有 AI Search 返回 Git 文章来源，Convex 等问题在该次查询中未返回来源，不能据此声称完整语料已接入。该记录不要求为本轮公共对话链路补充模型 token。开发环境的真实匿名客户端读取评论、AI 会话及咨询列表，均须被后端拒绝。

新增本机检索入口后，211 项 Node 测试与 50 项 Convex 测试通过，类型检查 0 errors / 0 warnings，构建与产物核验通过。使用当时配置的三枚服务端密钥检查该轮 `dist/`，未发现密钥出现在生成文件中。

切换到 session claims 后，216 项 Node 测试与 54 项 Convex 测试通过，类型检查、构建、产物校验及服务浏览器 fixture 均通过。删除开发环境旧 issuer 变量和 Clerk Secret Key 后，实际登录账户刷新仍识别为 Pro。Worker 同时接受经签名、issuer、有效期与 session 信息验证的 `aud: "convex"` v2 token，避免启用 integration 后将正常会话误判为自定义 template。

本轮后续修复直接删除尚未上线的 `/chat/`、`/me/` 页面，不保留跳转或 sitemap 条目；登录回跳返回当前页面，面板只将公开 pathname 与所选功能保存到 sessionStorage，关闭后清理，不持久化身份或私有正文。关闭按钮 Tooltip 在面板内部渲染，避免局部主题丢失与手机 dialog 遮挡。后续类型检查、206 项 Node 测试、50 项 Convex 测试、构建与产物校验均通过；服务浏览器 fixture 覆盖登录回跳、显式关闭及 973、640、375、320px 提示位置。

生产发布仍遵循 [持续部署](continuous-deployment.md)：先真实登录和权限测试，再独立生产构建和发布。新的后端与前端需作为同一版本协调发布；未完成真实配置和联调时保留本地改动，不推送 production `main`。本站尚未上线 Clerk 与 Convex，不保留旧 `/api/chat` 兼容入口。

官方依据：[Clerk 与 Convex integration](https://clerk.com/docs/guides/development/integrations/databases/convex)、[Clerk session tokens](https://clerk.com/docs/guides/sessions/session-tokens)、[Clerk JWT templates](https://clerk.com/docs/guides/sessions/jwt-templates)、[Clerk Billing PricingTable](https://clerk.com/docs/react/reference/components/billing/pricing-table)、[Convex Agent Streaming](https://docs.convex.dev/agents/streaming)、[Cloudflare Workers AI 与 AI Gateway](https://developers.cloudflare.com/ai-gateway/usage/providers/workersai/)。本轮用 Context7 和官方当前页面核对，并以锁定依赖的实际类型检查实现。

2026-09-10 较早阶段验收（后续消息入口已改为铃铛）：顶部收敛为 AI 对话、咨询、我的、消息及仅作者可见的管理；我的提供收藏、喜欢、本人评论。新增通知与本人列表函数已同步到 development，84 项 Convex 业务与权限测试通过。完整 Node 测试、类型检查、构建及产物校验通过；后续搜索与生产配置变更另有定向回归。服务浏览器 fixture 覆盖 320–973px 导航、账户隔离、通知已读及目标定位、Billing 初始路径、评论与咨询图片及弹窗 Escape。左侧匿名 AI Search 已用真实 public endpoint 验证 Git 查询及站内导航；后续新增 50 篇公开文章，其中 31 篇索引失败，其余导入暂停，具体状态见 [AI Search 实际执行结果](ai-search.md#本次实际执行结果2026-09-10)。该阶段未发布生产，AI Chat 的真实生成验收在后续公共对话链路切换后完成，见本节开头。

同日真实登录验收发现并修复了分类切换时 Convex client 提前关闭的问题：父组件现在等待子组件清理订阅与 Clerk 身份后再关闭连接，同时保留账户/session 切换时立即丢弃旧缓存的行为。`npm run test:browser:convex-lifecycle` 使用真实 React、Convex SDK 与 Clerk Provider，验证清理顺序、StrictMode 重放及缓存隔离；旧同步关闭实现作为负向控制能复现原错误。浏览器 services fixture 也补齐了关闭后访问 auth 必须抛错的语义。实际已登录侧栏的收藏、喜欢、评论切换和头像菜单直接打开 Billing 均已通过；这是入口验证，不代表测试了付款或变更订阅。

喜欢与本人评论中的旧记录若缺少标题，优先使用当前页面标题，再从公开 `/search/references.json` 元数据恢复文章名称。请求不带 Cookie 或 Authorization，不读取文章正文，不改写用户记录；请求失败与异常路径编码均保留可点击的回退显示。完整 services 回归、类型检查（0 errors / 0 warnings）、普通预览构建和产物校验通过。

最终搜索调整后，242 项 Node 测试和 84 项 Convex 测试通过，类型检查 0 errors / 0 warnings；构建与产物核验通过，覆盖 1,247 个内容路由与 969 个评论页面。AI Search 临时故障会显示 Pagefind 全文结果与明确提示，配置或协议错误仍报错；1440px / 320px 隔离浏览器测试覆盖回退、重试及分页。实际预览页面对“Convex”返回两条 AI Search 结果并正常跳转原文，未使用回退。真实账户的「我的」分类切换、已有内容读取与 Billing 入口已验证；没有创建真实评论或咨询消息、测试付款或发布生产。
