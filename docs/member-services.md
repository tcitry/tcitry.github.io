# 账户、评论、AI 对话与咨询

本文是 Clerk + Convex 账户功能的当前说明。部署步骤见 [构建与发布](continuous-deployment.md)，AI Search 细节见 [AI Search](ai-search.md)。

## 架构

- Clerk：登录、账户资料和 Billing UI。原有登录入口打开由本站管理的单个登录窗口；窗口内的 `/sso-callback/` 使用官方登录注册组件完成 Google/GitHub 授权、注册与后续步骤。认证完成后原页面更新会话，收到确认的登录窗口倒计时关闭。实现与验收边界见下节。
- Convex：认证与授权、评论、喜欢、收藏、通知、咨询、附件、AI 会话和流式状态。
- `@convex-dev/agent`：AI thread、message 和 stream delta 持久化。
- Cloudflare AI Search：公开文章检索与回答生成；不保存私人账户数据。

浏览器使用 Clerk 为 Convex integration 提供的 audience `convex` session token。Convex 从 `ctx.auth.getUserIdentity()` 获取身份，业务函数不得信任客户端提交的用户 ID、角色、claims 或 `isPro`。

## OAuth popup 与回调

2026-09-16 调整：普通登录改为“本站打开一个窗口，Clerk 在该窗口内完成认证”。原页面不再先打开 modal，也不再调用 Clerk 的 `oauthFlow: 'popup'`。这是对窗口管理的明确接管；认证表单、OAuth、登录转注册、验证和 Session Tasks 仍由 Clerk 官方组件处理。`/auth-test/` 与独立 `/sign-up/` 保持删除。

- 首页、助手、文章评论、匿名喜欢及收藏共用 `openClerkAuthWindow()`。它在原始按钮事件中同步打开 `/sso-callback/?auth_window=<随机标记>`，请求 popup 窗口尺寸；Google 与 GitHub 使用同一路径。浏览器仍决定最终窗口外观，弹窗被拦截时入口显示重试提示。
- 窗口内用 `client:only="react"` 挂载 `<SignIn routing="hash" withSignUp oauthFlow="redirect" />`。`redirect` 在这个已打开的窗口内前往 OAuth 提供方并返回，避免再启动一层 OAuth popup。`ClerkProvider` 保留相对 `signInUrl="/sso-callback/"` 与官方 combined flow；`#/sso-callback`、`#/create/sso-callback`、资料补全、验证和 Session Tasks 都由官方路由承接。
- 窗口的标记保存在其自身 `sessionStorage`，供跨域授权返回后恢复。窗口模式下登录与注册的 force/fallback URL 均指向该次尝试的 `/sso-callback/` 完成地址。原页面不参与这些跳转，因此其文章 URL、query、hash 和页面状态保持原位。无窗口标记的旧回调继续尊重原有 redirect 参数。
- 只有 `session.status === 'active'` 且没有 `currentTask` 才进入窗口完成界面。窗口通过随机标记对应的同源 `BroadcastChannel` 通知原页；原页调用公开 `client.reload()`，确认收到的 session ID 属于当前浏览器 client、状态为 active 且无待办，再用公开 `setActive()` 更新会话。消息本身不作为已登录凭据，不传递 JWT 或 OAuth token。
- 原页确认会话后发回确认消息，窗口显示英文成功文案并倒计时 3 秒关闭。未收到确认时最多重试 30 秒，然后提示回到原标签页刷新；不提前自动关闭。原页监听最多保留 15 分钟，不通过轮询 `popup.closed` 判断 OAuth 是否结束，避免跨域 COOP 切断窗口引用时过早清理。
- 本站维护窗口、同源通知、确认和关闭；不覆盖 Clerk 的认证方法，不手写 OAuth transfer 或 `handleRedirectCallback`。Google One Tap 保留独立适配。已有 `routerPush` / `routerReplace` 仍避免同页锚点跳转产生错误卸载信号。
- Clerk Dashboard 与 OAuth 提供方配置无需因本方案改变。GitHub OAuth App 的 Authorization callback 仍为 Clerk Frontend API 的 `oauth_callback`。切换版本后应关闭旧认证窗口并刷新原页面，再从原按钮开始。

验证边界：本地检查覆盖窗口状态、消息确认、真实 Clerk client 会话校验条件与官方组件配置；既有 `test:browser:clerk-ui`、`test:browser:clerk-navigation` 覆盖多 island 复用及导航适配。这些 fixture 不替代真实 OAuth 验收。用户已明确要求先完成检查与生产部署，再自行从原登录入口验证 Google/GitHub 回访、新用户注册及补资料；本轮不代用户执行真实账户测试。生产上线以部署记录及线上版本为准，不能把构建成功写成真实登录已通过。

依据：[Clerk SignIn 属性](https://clerk.com/docs/react/reference/components/authentication/sign-in)、[重定向配置](https://clerk.com/docs/guides/development/customize-redirect-urls)、[公开 setActive 参数](https://clerk.com/docs/reference/types/set-active-params)、[Clerk JS 6.32.0 源码](https://github.com/clerk/javascript/blob/%40clerk%2Fclerk-js%406.32.0/packages/clerk-js/src/core/clerk.ts)、[UI 1.33.0 modal combined-flow 修复](https://github.com/clerk/javascript/pull/9758)。本次实际浏览器运行时为 Clerk JS 6.32.0 / UI 1.33.0；CDN 运行时可独立于站点发布更新，本地 React SDK 版本以 lockfile 为准。

## 助手面板

右下入口打开统一助手面板：

- 「我的」：收藏、喜欢和本人评论。
- 「AI 对话」：Convex Agent 会话与历史。
- 「咨询」：当前账户的真人咨询。
- 「管理」：仅已验证作者可见的咨询收件箱。
- 铃铛：评论回复和咨询回复通知。

会员状态和订阅管理位于 Clerk 头像菜单，不设置独立会员 tab。切换用户或 session 时销毁旧 Convex client，并清空私人列表、选择状态和草稿，防止上一账户数据短暂可见。

Google One Tap 复用同一 Clerk 账户，只在符合生产配置且未登录时展示。其独立适配继续处理首次 Google 用户的 sign-in-or-up transfer，并将成功目标设为当前页（含 hash）；不通过全局 listener 发起 transfer。

## AI 对话

登录后免费使用 AI 对话，不要求 Pro。链路为：

```text
浏览器 → Clerk/Convex → Convex Agent
       → AI Search /search 预检
       → AI Search /chat/completions
       → Convex 保存消息、来源和流式状态
```

对应 Convex deployment 的 `AI_SEARCH_PUBLIC_URL` 与前端 `AI_SEARCH_PUBLIC_URL` 指向同一实例。回答模型和 Gateway 由 AI Search 实例配置决定；浏览器不能提交模型、Gateway 或系统提示。

每次回答只采用当前发布引用清单中通过 key、canonical URL、content hash 和 source kind 校验的公开文章。没有可信来源时不生成无依据回答。私人会话、评论、咨询、收藏和附件不进入索引。

会话访问按 Clerk identity 隔离。创建会话和发送问题使用 Convex rate limiter；请求 ID 保证重试幂等。生成在后台 action 中执行，支持停止、超时、失败结算、刷新恢复和历史分页。失败或取消轮次可以显示，但不作为后续模型上下文；追问只继承同一会话中完整成功的最近问答。

旧 Worker `/api/chat` 和 `/api/internal/retrieve` 已删除，不是兼容入口。

## 评论、喜欢与收藏

评论以 canonical pathname 关联文章，仅在 `docs`、`posts`、`about`、`weekly`、`links` 的独立内容页启用。

- 未登录：只读取评论数、喜欢数和登录提示。
- 已登录：读取评论正文、回复、附件和个人状态；可以发布、回复、删除、喜欢和收藏。已登录但 Convex 尚未就绪时，喜欢和收藏说明原因并提供重试，不得静默禁用。
- 所有正文、附件和个人状态查询都必须在 Convex 后端鉴权，不能只依赖 UI 隐藏。
- 评论显示 Clerk username，不用邮箱或私有身份 ID 兜底。缺少用户名时，评论区引导通过 Clerk `user.update({ username })` 设置；Convex 只读取 session 中的 `preferred_username` / `nickname`，不接受浏览器提交的作者名。已发布评论的公开头像来自同一 session 的 OIDC `picture`（Convex `pictureUrl`），只接受合理的 https URL，不接受浏览器提交的头像；缺失或非法时显示姓名首字母。删除时清除头像。已登录打开评论区时，用当前 JWT `pictureUrl` 覆盖刷新本人所有未删除评论的头像（含已有旧 URL，不只补缺）；`picture` 缺失或非法时跳过，不清空已有头像；已删除评论保持清空、不回写。不使用 `CLERK_SECRET_KEY` 或 Clerk Backend API。Session claims 在 Clerk Dashboard 映射，本仓库没有 JWT template。
- 喜欢与收藏按账户幂等写入；客户端不能指定归属。
- 删除父评论时清除正文和附件，保留讨论链占位。

历史 GitHub Discussions 在单独迁移前保持不变。迁移需要保留公开作者、时间、回复关系和来源标记，不按同名自动认领到 Clerk 账户。

## 咨询与会员

真人咨询使用站内异步私聊。用户只能读取和写入自己的咨询；作者收件箱和回复函数只允许配置的作者 identity 调用。

咨询是否对全站开放，只由对应 Convex deployment 的 `CONSULTATION_ADMIN_TOKEN_IDENTIFIER` 决定。未配置作者 identity 时，咨询入口显示「尚未开放」，且不出现禁用的「发起咨询」。

新建或继续咨询时，Convex 从已验证 Clerk v2 session `pla` claim 判断个人 Pro 权益：

- `CLERK_PRO_PLAN_SLUG` 必须精确匹配 Clerk Billing 个人计划 slug；development 与 production Convex 都要配置，且各自对应同环境 Clerk 计划；
- scope 必须包含个人范围 `u`、`ou` 或 `uo`；
- 仅组织 scope `o`、未知 scope、缺失或无效 claim 均不授予 Pro；
- JWT 过期时间不是订阅结束日期，账期由 Clerk Billing UI 展示。

slug 缺失或无效时无法核验 Pro，后端拒绝新建咨询，但前端不得表现为全站关闭：已登录非 Pro（含无法核验计划）看到 Pro 说明和「开通 Pro」，打开 Clerk Billing。订阅失效后仍可读取自己的历史，但新增付费留言需要重新通过权益检查。权益查询失败应显示错误和重试，不得显示为免费账户，也不得留下无说明的禁用「发起咨询」。

## 图片附件

评论和咨询使用 Convex File Storage，但用途与归属不可互换。

- 每条最多 4 张，每张不超过 5 MB；接受 JPEG、PNG、WebP 和 GIF。
- 上传、绑定和读取均在服务端检查身份、用途和所属会话或评论。
- 客户端不获得可绕过登录的永久公开 Storage URL。
- 读取通过带 Clerk JWT 的 HTTP endpoint，每次重新检查权限并返回 private/no-store。
- 未绑定上传由后台清理；删除内容时同步处理附件关系。

## 环境变量

在每个 Convex deployment 分别配置：

| 变量 | 用途 |
| --- | --- |
| `CLERK_FRONTEND_API_URL` | 对应 Clerk 实例的可信 issuer |
| `CLERK_PRO_PLAN_SLUG` | 个人 Pro 计划 slug；production Convex 必须与 Clerk production Billing 计划一致，否则无法核验 Pro |
| `CONSULTATION_ADMIN_TOKEN_IDENTIFIER` | 作者的完整 `tokenIdentifier`；缺失时咨询全站关闭 |
| `AI_SEARCH_PUBLIC_URL` | 与前端相同的 AI Search public endpoint |

前端构建配置 `PUBLIC_CLERK_PUBLISHABLE_KEY`、`PUBLIC_CONVEX_URL` 和 `AI_SEARCH_PUBLIC_URL`。当前认证和 Pro 授权不使用 `CLERK_SECRET_KEY` 或 Clerk Backend API。

真实值只放 Git 忽略的 env 或平台设置；`.env.example` 只维护字段说明。本地文件不会自动设置 Convex cloud 环境。

## 验收

发布前至少验证：

1. 匿名用户不能读取评论正文、私人列表、AI 会话、咨询或附件。
2. 两个真实账户之间不能读取、修改或短暂看到对方数据。
3. 普通用户不能访问作者管理接口，也不能伪造 Pro、角色或 ownership。
4. 评论、回复、喜欢、收藏、通知、咨询和图片在刷新后保持正确。
5. AI 首问、追问、停止、失败重试和刷新恢复均保存正确来源与终态。
6. 退出、切换账户和 session 更新后旧缓存立即失效。
7. production 前端、Clerk、Convex 和 AI Search 配置属于预期环境。

Fixture 和单账户验证不能替代真实双账户权限测试；函数执行成功也不能替代业务记录终态检查。
