# 账户、评论、AI 对话与咨询

本文是 Clerk + Convex 账户功能的当前说明。部署步骤见 [构建与发布](continuous-deployment.md)，AI Search 细节见 [AI Search](ai-search.md)。

## 架构

- Clerk：登录、账户资料和 Billing UI。保留 Google OAuth、Google One Tap 及原有邮箱、密码、用户名登录配置，停用 GitHub 认证。普通登录先打开官方 Clerk modal；必要的后续流程使用 Clerk 实例默认的 Account Portal，本站不再维护 `/sso-callback/` 页面。窗口通信、账号注册、会话激活及回跳由 Clerk 管理。
- Convex：认证与授权、评论、喜欢、收藏、通知、咨询、附件、AI 会话和流式状态。
- `@convex-dev/agent`：AI thread、message 和 stream delta 持久化。
- Cloudflare AI Search：公开文章检索与回答生成；不保存私人账户数据。

浏览器使用 Clerk 为 Convex integration 提供的 audience `convex` session token。Convex 从 `ctx.auth.getUserIdentity()` 获取身份，业务函数不得信任客户端提交的用户 ID、角色、claims 或 `isPro`。

## 原生登录与后续流程

2026-09-16 范围修正：仅停用 GitHub 登录与注册，保留 Google、Google One Tap，以及此前的邮箱、密码和用户名登录配置。普通入口仍在原页面打开官方 Clerk modal；用户选择 Google 后启动原生 OAuth popup，邮箱等方式使用官方表单。One Tap 直接挂载官方组件，不再覆盖认证或 callback 方法，也不手写新用户创建或 transfer。

**配置状态（2026-09-16）**：production 与 development 均已恢复调整前的完整邮箱、用户名、密码属性，并通过 Frontend API 读回确认与调整前一致；production 的身份方式、认证因子和密码配置也已比对通过。Google 保持启用，GitHub connection 的 `enabled`、`authenticatable` 继续为 `false`。此次未删除账号、撤销会话或清理历史密码数据，Billing 配置保持不变，历史 GitHub Discussions 也不受影响。

- `ClerkProvider` 不再设置 `signInUrl` 或 `signUpUrl`，使用 Clerk 实例的默认 Account Portal 地址。生产默认地址已通过 Frontend API 配置读回核验。本站删除 `/sso-callback/` 的 Astro 页面、组件和布局；`/auth-test/`、独立 `/sign-in/` 与 `/sign-up/` 也不提供入口。
- 普通入口使用官方 `SignInButton mode="modal"` 或 `openSignIn()`，保留 `oauthFlow: 'popup'`、`withSignUp: true`。Account Portal 只承接 Clerk 需要继续完成的注册、验证、资料补全或 Session Tasks，不替代初始 modal 入口。
- 入口的 `forceRedirectUrl` 和 `signUpForceRedirectUrl`、Provider 的登录注册 fallback 均使用当前完整 URL，保留 query 与评论 hash。没有本站 callback 页或额外返回路径存储。
- Google One Tap 仅在 production 配置使用 `pk_live_` 且用户未登录时展示，登录与注册成功目标同样为当前完整 URL。本站不改写 `authenticateWithGoogleOneTap` 或 `handleGoogleOneTapCallback`，不调用 `signUp.create()` 补做首次注册。
- popup 的窗口通信、登录转注册及会话激活由 Clerk 处理；本站不覆盖 `authenticateWithPopup` / `authenticateWithRedirect`，不维护窗口消息、关闭重试或手写 `handleRedirectCallback`。官方续流程可能发生页面导航，不能保证所有注册、验证步骤全程留在 popup。
- Provider 的公开 `routerPush` / `routerReplace` 适配继续保留：目标与当前 URL 完全相同时直接返回，同文档不同锚点使用浏览器原生导航，跨文档交回 `metadata.windowNavigate`。这是针对此前 Clerk JS 6.31.0 同页锚点导航产生卸载信号的修复，不手工派发 `clerk:beforeunload` 或调用内部会话恢复方法。

验证边界：单元测试覆盖 modal 入口、One Tap 配置门槛、完整返回 URL、Provider 多 island 复用，以及认证和 callback 方法未被修改。构建验证要求旧认证页面不生成，部署验证要求 `/sso-callback/` 及无尾斜线路径返回真实 404。既有浏览器检查入口保留，本轮不代用户运行浏览器或真实账号测试。平台配置读回、代码生产发布及真实 OAuth 验收分别记录；配置读回不代表 Account Portal 页面 HTTP 验收或真实登录通过。

依据：[Clerk SignIn 属性](https://clerk.com/docs/react/reference/components/authentication/sign-in)、[SignInButton](https://clerk.com/docs/react/reference/components/unstyled/sign-in-button)、[GoogleOneTap](https://clerk.com/docs/react/reference/components/authentication/google-one-tap)、[重定向配置](https://clerk.com/docs/guides/development/customize-redirect-urls)。最近一次线上核对的运行时为 Clerk JS 6.32.0 / UI 1.33.0（2026-09-16）；此前 6.31.0 导航源码是历史排查依据。CDN 运行时可独立于站点部署更新，代码回退不会自动回退该版本；本地 React SDK 版本以 lockfile 为准。

## 助手面板

右下入口打开统一助手面板：

- 「我的」：收藏、喜欢和本人评论。
- 「AI 对话」：Convex Agent 会话与历史。
- 「咨询」：当前账户的真人咨询。
- 「管理」：仅已验证作者可见的咨询收件箱。
- 铃铛：评论与咨询消息。读者看到自己评论的回复，以及博主对自己咨询的回复；作者看到全部新评论、楼中楼回复和全部新咨询消息。未读数量同时显示在铃铛和右下角助手入口。点击一条消息链接即标记已读。

会员状态和订阅管理位于 Clerk 头像菜单，不设置独立会员 tab。切换用户或 session 时销毁旧 Convex client，并清空私人列表、选择状态和草稿，防止上一账户数据短暂可见。

Google One Tap 复用同一 Clerk 账户，只在符合生产配置且未登录时展示；使用官方组件及当前页返回参数，首次注册与会话处理交给 Clerk。

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
