# Convex 后端

本站使用 Clerk + Convex 提供评论、喜欢、收藏、通知、咨询、附件和 AI 会话。产品行为、配置和验收以 [账户服务](../docs/member-services.md) 为准；AI Search 链路见 [AI Search](../docs/ai-search.md)。

## 开发规则

- 修改 `convex/` 前先读 `_generated/ai/guidelines.md`。
- 使用 `identity.tokenIdentifier` 作为账户归属，不接受客户端用户 ID 作为授权依据。
- 公开函数只暴露客户端确实需要的接口；内部流程使用 internal functions。
- 所有参数使用 Convex validators，集合查询使用 index 和 cursor pagination。
- 私人正文、附件、角色和 Pro 权益必须在后端校验。
- 修改 schema/functions 后运行 `npm run convex:codegen`、`npm run check:convex` 和 `npm run test:reader`；不要手写 `_generated/`。

## 认证与环境

Clerk 启用 Convex integration，客户端使用 audience `convex` 的 session token。`auth.config.ts` 从对应 deployment 的 `CLERK_FRONTEND_API_URL` 获取可信 issuer；development 和 production 分别配置。

Convex deployment 使用的业务变量：

- `CLERK_FRONTEND_API_URL`
- `CLERK_PRO_PLAN_SLUG`（development / production 各自对应同环境 Clerk Billing 个人计划 slug；缺失时无法核验 Pro，不等于咨询全站关闭）
- `CONSULTATION_ADMIN_TOKEN_IDENTIFIER`
- `AI_SEARCH_PUBLIC_URL`

本地 `.env` 不会自动写入 Convex cloud。真实值只在对应 deployment 或 Git 忽略文件中维护。

## 模块边界

| 模块 | 职责 |
| --- | --- |
| `reader` | 本人收藏 |
| `comments` | 评论、回复、文章/评论喜欢和本人列表 |
| `notifications` | 当前收件人的评论与咨询回复通知 |
| `consultations` | 本人咨询、作者收件箱、Pro 写入检查 |
| `commentImages` / HTTP routes | 评论和咨询图片上传、绑定、鉴权读取与清理 |
| `assistant` | AI 会话、运行状态、限流、取消和流式持久化 |
| `assistantPublicSearch` | AI Search public endpoint、引用版本和来源校验 |
| `assistantModel` | `/chat/completions` 模型适配与安全输出 |

`@convex-dev/agent` 保存 AI threads/messages/stream deltas，`@convex-dev/rate-limiter` 保护写入和对话频率。私人数据不进入公开 AI Search。

## 不变量

- 评论和页面行为以 canonical pathname 为键，标题只用于显示。
- 作者身份由完整 `CONSULTATION_ADMIN_TOKEN_IDENTIFIER` 确定。
- Pro 权益来自已验证 session `pla` claim，并在实际咨询写入时检查。
- 评论和咨询附件用途隔离，不返回永久公开 Storage URL。
- 新回复与通知在同一事务写入，自己的回复不通知自己。
- AI 对话只采用同一账户、同一会话中完整成功的上下文，并保存经过当前发布引用校验的来源。
