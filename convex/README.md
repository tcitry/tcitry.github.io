# 收藏与账户服务后端

收藏、AI 会话、Pro 异步咨询和登录后可见的评论保存在 Convex，统一使用 Clerk 登录。会员使用 Clerk Billing；配置与联调边界见 [账户服务](../docs/member-services.md)。Giscus 历史评论暂缓迁移。
所有 reader functions 都要求已认证的 Clerk 身份，并在服务端用
`identity.tokenIdentifier` 隔离所有读写。客户端不能传入用户 ID。

在 Clerk 中启用 Convex integration，客户端使用 audience 为 `convex` 的 session token，无需另建 JWT template。
`auth.config.ts` 从对应 Convex deployment 的 `CLERK_FRONTEND_API_URL` 读取 Frontend API URL，
作为可信 JWT issuer，并保持 `applicationID: "convex"` 校验 audience。
开发与生产分别使用各自的 Clerk instance 和 Convex deployment。
完整环境配置与发布入口以站点根目录的说明及 `package.json` 为准。

Pro 授权从已验证身份读取 Clerk v2 session token 的 `pla` claim，精确匹配包含个人 scope
（`u`、`ou` 或 `uo`）且 slug 等于 `CLERK_PRO_PLAN_SLUG` 的套餐。仅组织 scope `o` 的套餐不能冒充个人套餐；
未知 scope、缺失或无效 claim 拒绝新增付费留言。
咨询在实际写入的 mutation 中执行该检查，不需要 Clerk Secret Key 或 Backend API 请求。
权益变化随短期 token 刷新生效；JWT 到期时间不是订阅到期日，详细账期由 Clerk 账户组件展示。

## AI 对话运行时配置

左侧匿名搜索由浏览器通过构建变量 `PUBLIC_AI_SEARCH_URL` 调用既有 AI Search 的 `/search`。
登录后免费使用的 AI Chat 则由 Convex Agent 保存会话，并通过对应 Convex deployment 的
`AI_SEARCH_PUBLIC_URL` 调用同一实例的公共 `/chat/completions`。回答模型默认继承 AI Search
实例设置，不再通过 Convex 的 Cloudflare REST 凭据固定指定旧 Qwen 模型或 Gateway。
开发与生产共用既有 AI Search 和关联 Gateway；Clerk/Convex 仍分别隔离。公共端点可使用
默认域名或已激活的自定义 HTTPS 域名，前端与 Convex 配置同一 hostname；源码不保存真实地址。
Gateway 自定义域名用于直接 Gateway 调用，不替代这里的 AI Search 端点。
2026-09-10 已部署到 development，并在真实 Clerk 登录页面验证：首问生成完整回答及一篇
核验来源，刷新后回答与引用恢复，中文追问继续生成完整回答及本轮引用。development 已配置
`AI_SEARCH_PUBLIC_URL` 并移除下列四个旧运行时变量；移除后再次从真实登录页面提问 Convex，
仍得到完整回答及来源。production 未部署、未修改配置。
这不代表全部文章已完成索引或所有查询都稳定，测试记录和上游限制见
[账户服务验收](../docs/member-services.md#验收与发布)。

公共 Cloudflare endpoint 自身不提供 Clerk 鉴权；站内 Agent 的读写、生成与历史记录仍由
Convex 校验已登录身份并按账户/session 隔离，引用继续核验当前公开文章的 key、canonical URL
和 content hash。公开搜索不发送 Clerk 凭据，私人会话、咨询和评论不加入公开索引。

新链路不需要在 Convex 配置 `BLOG_RETRIEVAL_URL`、`RAG_BRIDGE_SECRET`、
`CLOUDFLARE_ACCOUNT_ID` 或 `CLOUDFLARE_API_TOKEN`。后两个变量仍用于本地/CI 的文章索引同步
及发布，不能全局删除。`.env.local` 不会自动设置 Convex cloud 环境；无真实值的示例见
[`.env.example`](../.env.example)。旧 Worker `/api/chat` 与受保护检索桥代码暂保留，当前助手
前端使用 Convex，接入新链路不要求启动旧 bridge 或 tunnel。

## 业务接口与权限

| API | 行为 |
| --- | --- |
| `reader.getPage({ pathname })` | 仅返回本人的 `{ bookmarked }` |
| `reader.setBookmark({ pathname, title, bookmarked })` | 幂等设置收藏，返回 boolean |
| `reader.listLibrary({ paginationOpts })` | 仅返回本人的收藏，按更新时间倒序分页；每条包含 `pathname`、`title`、`updatedAt` |
| `consultations.listThreads({ paginationOpts })` | 只返回当前账户自己发起的咨询，作者账户也遵循此限制 |
| `consultations.listInbox({ paginationOpts })` | 仅配置的作者可查询全部咨询，按更新时间倒序分页 |
| `consultations.send({ threadId, content, imageIds?, requestId })` | 仅所属用户可发送会员留言，实际写入时核验 Pro 权益并绑定本人咨询附件 |
| `consultations.reply({ threadId, content, imageIds?, requestId })` | 仅配置的作者可回复，服务端记录为作者消息并绑定本人咨询附件 |
| `comments.getSummary({ pathname })` | 公开返回评论数量与文章喜欢数量，不含正文、身份或图片 |
| `comments.list({ pathname, paginationOpts })` | 登录后分页读取正文、回复、喜欢状态及认证图片 endpoint |
| `comments.listMine({ paginationOpts })` | 分页读取本人未删除的评论和回复，不返回图片 URL 或其他作者信息 |
| `comments.listLikedArticles({ paginationOpts })` | 分页读取本人喜欢的文章，复用文章点赞记录 |
| `comments.add({ pathname, body, parentId?, imageIds? })` | 仅使用已签名 Clerk username；绑定本人评论附件 |
| `comments.setLike({ pathname, liked, title? })` | 登录后幂等喜欢或取消喜欢文章；标题仅用于展示 |
| `comments.setCommentLike({ pathname, commentId, liked })` | 登录后幂等喜欢或取消喜欢同页评论 |
| `notifications.list({ paginationOpts })` | 仅收件人可读的评论回复、咨询回复通知；读取时重新检查来源和目标权限 |
| `notifications.markRead({ id })` | 仅收件人可以幂等标记已读 |

新回复与通知在同一事务写入，自己的回复不通知自己。通知只存目标引用；来源被删除或无权访问时目标返回 `null`。不回填历史回复。

图片上传为 `POST /comment-images/upload`，咨询用途加 `?purpose=consultation`；图片实际读取为
`GET /comment-images/file?imageId=…`。两者均使用 Clerk Bearer token，在 Convex HTTP actions 内鉴权。
咨询图仅会话双方能读，评论图仅登录用户能读，未绑定图仅上传者能读；不下发公开 Storage URL。
服务端验证实际字节数、MIME 和文件签名，单图 5 MB、每消息/评论 4 张；未绑定草稿 24 小时清理。
配置与 username claim 映射见 [账户服务](../docs/member-services.md#评论用户名与图片)。

咨询详情、消息读取和关闭仅允许所属用户或配置的作者。客户端不指定发送者身份；
两个发送接口在实际 mutation 中分别验证身份，跨角色重用同一请求 ID 会被拒绝。

`pathname` 取页面的 canonical URL 路径，服务端归一化百分号编码与末尾 `/`。
页面标题只用于显示，不作身份或记录键。查询结果不包含身份标识、姓名、邮箱。
阅读进度与私有笔记功能已停用，对应读写 API 已移除。既有 `readingProgress`、`privateNotes`
表暂时保留存储，当前业务不读写，也不自动删除已有记录。取消收藏使用
`setBookmark({ pathname, title, bookmarked: false })`，只影响本人该页面的收藏。

所有集合查询使用 owner index 和原生 cursor pagination。每次请求 1–50 条；
保留 Convex 的 `endCursor`、`splitCursor` 等分页字段。写操作使用
`@convex-dev/rate-limiter` component：每用户每分钟 60 次，burst capacity 30。
无变化的幂等写入不消耗额度。

本地测试使用 `convex-test` + Vitest 的 `edge-runtime`，覆盖身份隔离、匿名拒绝、
收藏与取消收藏、幂等、输入边界、分页和速率限制。运行站点的 `test:reader` 入口。
修改后通过 Convex CLI 生成 `_generated/`，不要手写生成文件。

参考：[Clerk 集成](https://docs.convex.dev/auth/clerk)、
[Pagination](https://docs.convex.dev/database/pagination)、
[Rate limiter component](https://github.com/get-convex/rate-limiter)、
[convex-test](https://docs.convex.dev/testing/convex-test)。
