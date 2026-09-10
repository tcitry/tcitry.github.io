# 账户、评论、AI 对话与咨询

本文是 Clerk + Convex 账户功能的当前说明。部署步骤见 [构建与发布](continuous-deployment.md)，AI Search 细节见 [AI Search](ai-search.md)。

## 架构

- Clerk：登录、账户资料和 Billing UI。
- Convex：认证与授权、评论、喜欢、收藏、通知、咨询、附件、AI 会话和流式状态。
- `@convex-dev/agent`：AI thread、message 和 stream delta 持久化。
- Cloudflare AI Search：公开文章检索与回答生成；不保存私人账户数据。

浏览器使用 Clerk 为 Convex integration 提供的 audience `convex` session token。Convex 从 `ctx.auth.getUserIdentity()` 获取身份，业务函数不得信任客户端提交的用户 ID、角色、claims 或 `isPro`。

## 助手面板

右下入口打开统一助手面板：

- 「我的」：收藏、喜欢和本人评论。
- 「AI 对话」：Convex Agent 会话与历史。
- 「咨询」：当前账户的真人咨询。
- 「管理」：仅已验证作者可见的咨询收件箱。
- 铃铛：评论回复和咨询回复通知。

会员状态和订阅管理位于 Clerk 头像菜单，不设置独立会员 tab。切换用户或 session 时销毁旧 Convex client，并清空私人列表、选择状态和草稿，防止上一账户数据短暂可见。

Google One Tap 复用同一 Clerk 账户，只在符合生产配置且未登录时展示；登录后返回当前页面。

## AI 对话

登录后免费使用 AI 对话，不要求 Pro。链路为：

```text
浏览器 → Clerk/Convex → Convex Agent
       → AI Search /search 预检
       → AI Search /chat/completions
       → Convex 保存消息、来源和流式状态
```

对应 Convex deployment 的 `AI_SEARCH_PUBLIC_URL` 与前端 `PUBLIC_AI_SEARCH_URL` 指向同一实例。回答模型和 Gateway 由 AI Search 实例配置决定；浏览器不能提交模型、Gateway 或系统提示。

每次回答只采用当前发布引用清单中通过 key、canonical URL、content hash 和 source kind 校验的公开文章。没有可信来源时不生成无依据回答。私人会话、评论、咨询、收藏和附件不进入索引。

会话访问按 Clerk identity 隔离。创建会话和发送问题使用 Convex rate limiter；请求 ID 保证重试幂等。生成在后台 action 中执行，支持停止、超时、失败结算、刷新恢复和历史分页。失败或取消轮次可以显示，但不作为后续模型上下文；追问只继承同一会话中完整成功的最近问答。

旧 Worker `/api/chat` 和 `/api/internal/retrieve` 已删除，不是兼容入口。

## 评论、喜欢与收藏

评论以 canonical pathname 关联文章，仅在 `docs`、`posts`、`about`、`weekly`、`links` 的独立内容页启用。

- 未登录：只读取评论数、喜欢数和登录提示。
- 已登录：读取评论正文、回复、附件和个人状态；可以发布、回复、删除、喜欢和收藏。
- 所有正文、附件和个人状态查询都必须在 Convex 后端鉴权，不能只依赖 UI 隐藏。
- 评论显示 Clerk username，不用邮箱或私有身份 ID 兜底。
- 喜欢与收藏按账户幂等写入；客户端不能指定归属。
- 删除父评论时清除正文和附件，保留讨论链占位。

历史 GitHub Discussions 在单独迁移前保持不变。迁移需要保留公开作者、时间、回复关系和来源标记，不按同名自动认领到 Clerk 账户。

## 咨询与会员

真人咨询使用站内异步私聊。用户只能读取和写入自己的咨询；作者收件箱和回复函数只允许配置的作者 identity 调用。

新建或继续咨询时，Convex 从已验证 Clerk v2 session `pla` claim 判断个人 Pro 权益：

- `CLERK_PRO_PLAN_SLUG` 必须精确匹配计划 slug；
- scope 必须包含个人范围 `u`、`ou` 或 `uo`；
- 仅组织 scope `o`、未知 scope、缺失或无效 claim 均不授予 Pro；
- JWT 过期时间不是订阅结束日期，账期由 Clerk Billing UI 展示。

订阅失效后仍可读取自己的历史，但新增付费留言需要重新通过权益检查。权益查询失败应显示错误和重试，不得显示为免费账户。

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
| `CLERK_PRO_PLAN_SLUG` | 个人 Pro 计划 slug |
| `CONSULTATION_ADMIN_TOKEN_IDENTIFIER` | 作者的完整 `tokenIdentifier` |
| `AI_SEARCH_PUBLIC_URL` | 与前端相同的 AI Search public endpoint |

前端构建配置 `PUBLIC_CLERK_PUBLISHABLE_KEY`、`PUBLIC_CONVEX_URL` 和 `PUBLIC_AI_SEARCH_URL`。当前认证和 Pro 授权不使用 `CLERK_SECRET_KEY` 或 Clerk Backend API。

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
