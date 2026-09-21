# AI Search、AI Gateway 与文章同步

本站复用一个 AI Search 实例 `tcitry-blog-search`（`default` namespace）及其关联 Gateway `tcitry-blog-chat`。文章使用 AI Search 内置存储，不配置重复的 R2、Vectorize 或网站爬虫数据源。

## 运行时架构

### 匿名站内搜索

匿名站内搜索使用构建时生成的 Pagefind 本地索引，不再调用 AI Search public endpoint：

- 不要求 Clerk 登录，不发送账户 token 或 Cloudflare API token；
- 浏览器懒加载 `/pagefind/pagefind.js`；
- 结果由本地索引过滤，URL、section 和 excerpt 在返回前再次校验；
- 空查询、危险 URL 和未索引路径直接拒绝。

### 登录后 AI 对话

Convex Agent 通过对应 deployment 的 `AI_SEARCH_PUBLIC_URL` 与 Workers AI 生成回答，检索仅走 AI Search `/search`：

1. 模型直接开始生成；博客事实类问题由模型自行调用 `search_blog`，寒暄、元问题、通用技术问题零次检索；
2. `search_blog` 内部调用 `/search` 并经过 `validatePublicChunk` 与 `references.json` 校验；query 去空后非空、≤200 字符、无控制字符，短指代 query 用上文主题词补全一次；
3. 每 run 最多 2 次工具调用，单次 6 秒、累计 12 秒超时，snippets 共用 14,000 字符预算，来源跨调用去重、编号稳定、最多 5 个；工具结果只含编号、标题、sourceKind、updatedAt、正文，不含 URL；检索失败返回 `{ok:false, reason:'unavailable'}`，不中断整轮；
4. 生成走 Workers AI OpenAI-compatible endpoint，经 Gateway `ASSISTANT_CHAT_GATEWAY`（默认 `tcitry-blog-chat`），模型 `ASSISTANT_CHAT_MODEL`（默认 `@cf/zai-org/glm-5.3`），需要 Convex deployment 配置 `CLOUDFLARE_ACCOUNT_ID` 与仅限 Workers AI 的 `CLOUDFLARE_API_TOKEN`；请求带 `reasoning_effort: low`；AI Search 只承担 `/search`，不再用于生产生成；
5. run 记录 `phase`（thinking / searching / writing）与 `toolCalls`，UI 据此显示「正在思考 / 正在检索文章 / 正在整理回答」；
6. 将消息、来源、流式增量和运行终态保存到 Convex。

旧 Worker `/api/chat` 和检索桥已删除，不再引入。评测用 `scripts/eval-ai-chat.mjs`（仍可对 AI Search `/chat/completions` 做实例级探针）；登录助手 TTFB 以 Workers AI 流式首字为准。

公开 endpoint 本身没有 Clerk 鉴权。站内 AI 对话仍由 Convex 验证身份、会话归属、限流和数据隔离。

## Public endpoint 与自定义域名

构建脚本和 Convex `AI_SEARCH_PUBLIC_URL` 必须使用同一 hostname。可以配置 Cloudflare 默认域名或已经激活的 AI Search 自定义 HTTPS 域名；校验拒绝：

- HTTP、IP、localhost、显式端口或内嵌凭据；
- 不支持的额外路径、query、fragment 或重定向；
- 构建与 Convex 指向不同实例的配置。

Search 自定义域名保留 `/search`（登录助手检索）与 `/chat/completions`（实例探针/评测，非生产生成路径）。AI Gateway 自定义域名是直接 Gateway 请求入口，不能填入 Search 配置。

## 实例配置

在 AI Search Dashboard 核对：

| 配置 | 本站约定 |
| --- | --- |
| 实例 | `tcitry-blog-search` |
| Namespace | `default` |
| AI Gateway | `tcitry-blog-chat` |
| 数据源 | Built-in storage |
| Embedding | 实例当前配置；与回答模型分开维护 |
| Chunk | 以真实中文和技术词召回测试调整 |
| Public endpoint | 启用 `/search`；`/chat/completions` 仅探针/评测 |
| Authorized hosts | 只允许实际开发和生产站点 origin |
| Query rewrite / reranking | 默认关闭，评估后再开启 |
| Similarity cache | 内容验证阶段关闭 |

不要用 Gateway 路由规则把 embedding 强制改写为聊天模型。Gateway rate limit 会同时影响索引、检索和回答；启用前应根据实际峰值为索引维护留出余量。应用内用户频率由 Convex rate limiter 单独控制。

## 公开语料

`npm run prepare:content` 从本次构建的公开内容集合导出 AI Search 文档，只包含独立的 `docs`、`posts` 和 `weekly` 页面。以下内容排除：

- 草稿、隐藏页、跳转页、空正文和业务索引页；
- `bookSearchExclude` 页面；
- 私有内容、完整 frontmatter、源文件路径和构建诊断；
- 评论、收藏、咨询、附件和 AI 会话。

导出正文来自已经渲染的公开 HTML，转换为 Markdown 并保留标题、列表、表格、链接和代码。ByAI 内容写入明确来源标识。

生成文件位于忽略的 `.generated/ai-search/`：

| 文件 | 用途 |
| --- | --- |
| `documents/<id>.md` | 单篇公开正文 |
| `references.json` | Worker/浏览器构建使用的可信 key、hash、URL 和标题清单 |
| `manifest.json` | 语料及来源提交声明 |
| `ai-search-sync.json` | 完整同步成功记录 |

远端 key 由 canonical URL 稳定生成；正文变化覆盖同一 key，URL 变化产生新 key。引用清单不包含完整正文，也不是远端索引状态报告。

## Bootstrap 与同步

首次空实例可导入固定公开样本：

```sh
npm run ai-search:bootstrap
npm run ai-search:bootstrap -- --apply
```

默认是 dry-run。`--apply` 只初始化空 metadata schema、上传固定样本并等待索引，不执行生产发布或全量删除。

全量同步：

```sh
npm run prepare:content
npm run ai-search:sync
npm run ai-search:sync -- --apply
npm run ai-search:sync -- --apply --best-effort
```

没有凭据时同步命令只报告本地语料或执行 dry-run。远端写入需要发布环境中的 `CLOUDFLARE_ACCOUNT_ID` 和受限 `CLOUDFLARE_API_TOKEN`；凭据不由 Wrangler OAuth、浏览器或本地认证存储自动推导。`--best-effort` 仅用于 `--apply`：在 `AI_SEARCH_SYNC_BUDGET_MS`（默认 8 分钟）内尽量提交，时间用尽后打印 `WARNING` 并以退出码 0 结束，不写完整成功记录。无预算的 `--apply` 仍会在未完成时失败。

同步规则：

- 读取远端完整分页并比较 key 与 content hash；
- 先完成新增和更新索引，再删除不再公开的本站托管 key；
- 先提交全部新增和更新，再等待索引完成；一条 queued/running 的文章不得阻止其余文章提交。轮询超时后对该篇再上传一次，第二次仍 pending 才失败；
- 不删除手工上传或其他数据源内容；
- 429、500、502、503、504 以及错误码 7001（Internal Error）遵守 `Retry-After` 并有限退避；超长 `Retry-After` 视为停止信号，用尽次数后仍失败；
- 上传成功后继续等待索引完成；
- 任一分页、hash、状态或限流异常都不写完整成功记录。

正式发布由 `deploy:verified` 在封存产物上线并完成线上核验后执行 best-effort 同步。Worker/Convex 部署、页面核验和 AI Search corpus/chat API 核验仍是硬失败；文章同步超时、被更新的生产版本中止或索引未完成只会告警，不会把 Workers Builds 打红。`--apply` 会重新校验 release、站点提交、内容提交、语料 bytes 和 deployment receipt；不能手工制造这些文件绕过检查。站点变绿不等于语料已经全量索引。

针对当前已发布版本、不重新上传 Worker 的一次回填见 [一次静默回填](continuous-deployment.md#一次静默回填)（`npm run ai-search:sync:published`）。该路径仍然使用 `assertPublishedCorpus`，不会对已下线的旧 release 继续写入。

## Metadata

实例维护五个 custom metadata 字段：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `canonical_url` | text | 正式文章 URL |
| `section` | text | `docs`、`posts` 或 `weekly` |
| `updated_at` | datetime | 公开更新时间 |
| `source_kind` | text | `author` 或 `ai-assisted` |
| `content_hash` | text | 当前导出正文 SHA-256 |

修改 schema 会触发重新索引。同步前脚本会校验字段名和类型，不带不完整 schema 写入。

## 验收

- 匿名 `/search` 不发送凭据，只展示通过引用清单校验的站内 URL 和纯文本摘要。
- 中文、技术词、跨文章问题、无结果、过期 hash、429、超时和取消行为符合预期。
- 登录后首问、追问、停止、失败重试和刷新恢复保留正确来源与终态。
- 左侧搜索和 Convex 使用同一 endpoint hostname，Gateway 日志对应同一实例配置。
- Items 中新增、更新、撤回和索引失败与本次发布语料一致。
- `/api/chat` 与 `/api/internal/retrieve` 保持 404。

索引状态和上游服务质量以 Dashboard、真实请求和发布验收为准，不把一次成功或测试 fixture 当作全量索引已经稳定。
