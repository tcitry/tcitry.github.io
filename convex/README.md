# Reader backend

收藏、阅读进度、私有笔记、AI 会话、Pro 异步咨询和登录后可见的评论保存在 Convex，统一使用 Clerk 登录。会员使用 Clerk Billing；配置与联调边界见 [账户服务](../docs/member-services.md)。Giscus 历史评论暂缓迁移。
所有 reader functions 都要求已认证的 Clerk 身份，并在服务端用
`identity.tokenIdentifier` 隔离所有读写。客户端不能传入用户 ID。

`auth.config.ts` 需要对应 Convex deployment 的 `CLERK_JWT_ISSUER_DOMAIN`。
Clerk 中配置名为 `convex` 的 JWT template，保留 `aud: "convex"`。
开发与生产分别使用各自的 Clerk instance 和 Convex deployment。
完整环境配置与发布入口以站点根目录的说明及 `package.json` 为准。

| API | 行为 |
| --- | --- |
| `reader.getPage({ pathname })` | 返回本人的 `bookmarked`、`progress`、`note`、`noteUpdatedAt` |
| `reader.setBookmark({ pathname, title, bookmarked })` | 幂等设置收藏，返回 boolean |
| `reader.saveProgress({ pathname, title, progress })` | 保存 0–100 的历史最高进度，返回已存进度；打开页首不覆盖已有进度 |
| `reader.saveNote({ pathname, title, note, expectedUpdatedAt })` | 保存纯文本笔记，最多 10,000 个字符；空文本删除；版本不符返回 `NOTE_CONFLICT` |
| `reader.listLibrary({ kind, paginationOpts })` | 按更新时间倒序分页；`kind` 为 `bookmarks`、`notes` 或 `progress` |
| `reader.clearPage({ pathname })` | 删除本人该路径的收藏、阅读进度和笔记 |

`pathname` 取页面的 canonical URL 路径，服务端归一化百分号编码与末尾 `/`。
页面标题只用于显示，不作身份或记录键。查询结果不包含身份标识、姓名、邮箱。
三类数据使用独立表，进度写入不会改动收藏或笔记的更新时间。

所有集合查询使用 owner index 和原生 cursor pagination。每次请求 1–50 条；
保留 Convex 的 `endCursor`、`splitCursor` 等分页字段。写操作使用
`@convex-dev/rate-limiter` component：每用户每分钟 60 次，burst capacity 30。
无变化的幂等写入不消耗额度。

本地测试使用 `convex-test` + Vitest 的 `edge-runtime`，覆盖身份隔离、匿名拒绝、
笔记并发冲突、删除、输入边界、分页和速率限制。运行站点的 `test:reader` 入口。
修改后通过 Convex CLI 生成 `_generated/`，不要手写生成文件。

参考：[Clerk 集成](https://docs.convex.dev/auth/clerk)、
[Pagination](https://docs.convex.dev/database/pagination)、
[Rate limiter component](https://github.com/get-convex/rate-limiter)、
[convex-test](https://docs.convex.dev/testing/convex-test)。
