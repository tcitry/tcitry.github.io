# 账户、AI 对话与会员咨询

2026-09-09：本轮在现有 Astro + Clerk + Convex + 单 Cloudflare Worker 上继续开发。本文记录实现边界与联调入口，不代表已经发布生产版本。

## 功能与数据

除文章评论外，登录、AI 对话、阅读、咨询和会员统一从右下圆圈进入。导航与正文不提供独立账户服务入口；尚未上线的 `/chat/`、`/me/` 开发页面已经删除，不保留兼容跳转或说明页。登录后返回当前文章，不经独立账户页面中转。

| 入口 | 数据与权限 |
| --- | --- |
| AI 对话 | Clerk 登录后使用；Convex Agent 保存线程、消息与生成状态，用户只能读取自己的会话 |
| 咨询 | Pro 会员给作者异步留言；所属用户与配置的作者可读，作者本人回复；历史读取不随订阅失效而消失 |
| 阅读 | 保留原有收藏、阅读进度和私有笔记 |
| 会员 | Clerk Billing PricingTable 展示控制台配置的价格、周期和套餐；后端直接核验当前用户的订阅 |
| 文章评论 | 登录后才能查看或参与；匿名只显示简短提示；用户自行填写公开昵称，允许删除自己的评论 |

评论保留在 `BookLayout` 的页脚前后篇导航之后，只用于独立的 docs、posts、about、weekly、links 内容页。Giscus 已从新页面实现中移除。历史 GitHub Discussions 保持原状；按照用户要求，等功能和 Convex schema 稳定后再做专门迁移，本轮不导入、不删除、不改写。

AI 对话使用 `@convex-dev/agent`，以 mutation 保存问题和调度任务，后台 action 检索并流式生成；客户端订阅持久消息。浏览器不提交 assistant 历史作为可信记录。每条业务会话关联一个 Agent thread，来源、状态与请求去重记录单独保存；停止、失败与超时均有持久状态。

Cloudflare AI Search 使用既有实例 `tcitry-blog-search`（全小写），通过当前 Worker 的唯一 `BLOG_SEARCH` binding 保留公开文章语料与发布流程。Convex 经当前 Worker 的服务端检索接口调用 AI Search，由 Worker 对照当前构建的 key 与 content hash 白名单过滤检索结果。Convex Agent 随后通过 Cloudflare 官方 OpenAI-compatible REST endpoint 调用固定 Qwen 模型，指定既有 Gateway `tcitry-blog-chat`。阅读笔记、咨询、评论和 AI 会话不加入公开文章索引。原 `/api/chat` 保留给旧客户端，新的助手面板使用 Convex 会话。

## Billing 与作者身份

本轮采用服务端按需核验：Convex 使用 `@clerk/backend` 的 `getUserBillingSubscription()` 获取已认证用户的订阅。仅接受精确匹配 `CLERK_PRO_PLAN_SLUG` 且处于有效期间的条目；试用在当前 SDK 中表示为 active item，取消但尚未到期的条目按剩余有效期处理。扣费失败、到期、未开始、无法核验和缺少配置均不授予新的付费留言权限。每次新开或发送咨询都重新核验，已经成功的同一请求重试不重复创建消息。

Convex 使用 `ConvexProviderWithClerk`：Clerk 已启用 Convex integration 时使用 audience 为 `convex` 的 session token；已配置名为 `convex` 的 JWT template 时也支持该方式。不能假定 template 包含 Billing session claims，也不依赖前端 `has()` 或浏览器传入的 `isPro`、owner、admin 作为权限来源。`CONSULTATION_ADMIN_TOKEN_IDENTIFIER` 必须是指定作者在当前 Clerk issuer 下的完整 `tokenIdentifier`；姓名、邮箱、显示昵称或单独 subject 都不作为全局管理身份。

套餐价格、周期、退款与服务承诺应先在 Clerk Billing 及实际服务规则中明确。代码不生成虚构价格，不承诺无限咨询或固定回复时限；生产收款前必须用实际测试付款和作者账户验收。

## 一次性配置

现有 `PUBLIC_CLERK_PUBLISHABLE_KEY`、`PUBLIC_CONVEX_URL`、Clerk Convex integration 和 `CLERK_JWT_ISSUER_DOMAIN` 继续按 [持续部署文档](continuous-deployment.md) 配置。development 与 production 必须分别设置，不能把测试实例的用户或权益带进生产。

| 配置位置 | 变量 | 用途 |
| --- | --- | --- |
| Convex 环境 | `CLERK_SECRET_KEY` | 对应 Clerk 实例的 Backend API，仅用于 Billing |
| Convex 环境 | `CLERK_PRO_PLAN_SLUG` | 控制台建立并提供咨询权益的个人 Pro 套餐 slug |
| Convex 环境 | `CONSULTATION_ADMIN_TOKEN_IDENTIFIER` | 唯一受信作者身份，用于咨询收件箱和评论管理 |
| Convex 环境 | `BLOG_RETRIEVAL_URL` | 当前站点 Worker 的 `/api/internal/retrieve` 完整 URL |
| Convex 与 Worker 环境 | `RAG_BRIDGE_SECRET` | 两端相同的随机服务端认证密钥；至少 32 字符 |
| Convex 环境 | `CLOUDFLARE_ACCOUNT_ID` | 既有 AI Gateway 所属账户 |
| Convex 环境 | `CLOUDFLARE_API_TOKEN` | 该账户模型调用所需的受限 token |

密钥不进入 `PUBLIC_` 变量、页面 HTML、客户端包、源码或 Git。Clerk Secret Key 不配置到 Worker。可填写的无真实值示例见 [`.env.example`](../.env.example)。写入站点 `.env.local` 并不会自动设置 Convex cloud deployment 的环境变量。

Clerk Dashboard 中启用个人 Billing，并配置实际计划。MembershipPanel 使用 Clerk PricingTable 与账户管理入口；不自行实现支付表单。账户配置未齐时显示尚未开放或可恢复的连接错误，不伪造订阅、模型结果或作者回复。

本地 Convex cloud development deployment 无法访问开发者机器的 `127.0.0.1`。真实 AI 联调须让 `BLOG_RETRIEVAL_URL` 指向该 development deployment 实际可达且使用匹配密钥的检索接口；纯本地后端才可使用同机地址。不要为绕过限制把检索接口公开免认证。

## 验收与发布

```sh
npm run convex:codegen
npm run check
npm test
npm run build
npm run verify
npm run test:browser
npm run test:browser:services
```

新功能测试应覆盖匿名和跨账户访问、伪造权益或作者角色、同一请求重试、私聊双向读写、分页、AI 停止/失败/恢复、来源版本过滤，以及匿名评论提示。浏览器 fixture 使用合成身份和数据，只证明组件行为；不能代替实际 Clerk 登录、Clerk Billing 付款、Convex 环境与 Gateway 请求验收。

2026-09-09 本地验收结果：`check` 通过（0 errors、0 warnings，8 条弃用提示）；204 项 Node 测试与 50 项 Convex 测试全部通过；普通预览构建与 `verify` 通过，保留全部 1,208 个既有 URL，并验证 967 个评论页面及私有目录排除规则。原有阅读、搜索与导航浏览器回归通过；会员服务 fixture 在桌面与手机尺寸下验证了咨询创建、发送、作者回复、关闭，匿名评论不查询数据，登录后安全渲染，以及 AI 历史、新会话、发送、停止、切换面板后的恢复和账户切换隔离。实际本地页面也已确认仅向匿名用户显示评论登录提示，不再加载 Giscus。

后续联调已将本轮函数与 Agent Component 同步到既有 Convex development deployment，并核对前端 Clerk issuer 与开发后端一致。用户已在浏览器完成真实 Clerk 登录；当前获取 Convex token 返回 `404 / resource_not_found`，仍需在 Clerk development 控制台核查 Convex integration/token 配置。开发后端尚缺 Billing、作者身份、模型 token 和 RAG bridge 配置，真实付款、付费私聊与 Agent Gateway 请求尚未完成验收。代码按用户要求保存在本地提交中，尚未推送站点或发布生产版本。

本轮后续修复直接删除尚未上线的 `/chat/`、`/me/` 页面，不保留跳转或 sitemap 条目；登录回跳返回当前页面，面板只将公开 pathname 与所选功能保存到 sessionStorage，关闭后清理，不持久化身份或私有正文。关闭按钮 Tooltip 在面板内部渲染，避免局部主题丢失与手机 dialog 遮挡。后续类型检查、206 项 Node 测试、50 项 Convex 测试、构建与产物校验均通过；服务浏览器 fixture 覆盖登录回跳、显式关闭及 973、640、375、320px 提示位置。

生产发布仍遵循 [持续部署](continuous-deployment.md)：先真实登录和权限测试，再独立生产构建和发布。新的后端与前端需作为同一版本协调发布；未完成真实配置和联调时保留本地改动，不推送 production `main`。旧前端在发布窗口仍可能调用原有 reader 或 `/api/chat`，本轮保留兼容入口。

官方依据：[Clerk 与 Convex integration](https://clerk.com/docs/guides/development/integrations/databases/convex)、[Clerk Billing PricingTable](https://clerk.com/docs/react/reference/components/billing/pricing-table)、[Clerk 用户订阅查询](https://clerk.com/docs/reference/backend/billing/get-user-billing-subscription)、[Convex Agent Streaming](https://docs.convex.dev/agents/streaming)、[Cloudflare Workers AI 与 AI Gateway](https://developers.cloudflare.com/ai-gateway/usage/providers/workersai/)。本轮用 Context7 和官方当前页面核对，并以锁定依赖的实际类型检查实现。
