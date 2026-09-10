# 站内搜索、博客助手与文章索引同步

本站复用 AI Search 实例 `tcitry-blog-search`（`default` namespace）及其关联的既有 AI Gateway `tcitry-blog-chat`，不创建第二套资源。文章使用 AI Search 内置存储，发布脚本通过 REST API 上传；左侧匿名搜索通过 Public endpoint `/search` 查询。登录后的 Convex Agent 对话已切换到同一实例的公共 `/chat/completions`，回答模型默认继承实例设置；2026-09-10 development 已通过真实登录首问、追问、刷新恢复及旧失败会话重试，来源与持久化状态均已核验；生产尚未部署本轮改动。旧 Worker binding 检索与 `/api/chat` 代码暂保留，但当前助手前端使用 Convex。Binding 不会自动监视 Git 仓库或上传本地文件，也无需另外创建 R2 bucket 或网站爬虫。[Cloudflare 内置存储说明](https://developers.cloudflare.com/ai-search/configuration/data-source/built-in-storage/)

## 左侧匿名搜索

左侧搜索保留 HeroUI Command、最近更新、快捷键、键盘选择与站内跳转；输入关键词后匿名调用既有 AI Search 的 Public endpoint `/search`，只取文章片段，不生成回答。搜索不要求 Clerk 登录，也不要求 Pro；右下角的 AI Chat 则要求登录，登录后免费使用。两者使用同一公开文章索引，但会话与会员权限仍由各自入口处理。[公共搜索 API](https://developers.cloudflare.com/ai-search/api/search/public-endpoint/)

从实例 Public endpoint 设置复制 origin 或 `/search` URL，放入 Git 忽略的 `.env.local` 的 `PUBLIC_AI_SEARCH_URL`，然后重启开发服务。生产构建在 Cloudflare Build variables 设置同名公开变量；源码和 `.env.example` 不保存真实地址。`check:production-config`、production 构建与发布封存会拒绝缺少配置、非 HTTPS、IP/本地主机、凭据、显式端口或错误 API 路径；封存还会检查它与实际编译值一致，不能编译后换地址直接发布。浏览器请求使用 `credentials: omit`，不发送 Clerk session、账户 ID 或 API token。Authorized hosts 只控制浏览器 CORS，不提供身份认证；本地开发需要允许实际预览 origin，生产需要允许正式站点 origin。[Authorized hosts](https://developers.cloudflare.com/ai-search/configuration/retrieval/public-endpoint/)

`src/lib/search-ai-client.ts` 发送 `query`，关闭 query rewriting、reranking 和 similarity caching，并请求最多 50 个、score 至少 0.4 的 chunks。适配器接受 REST envelope，按文章去重，首次显示 8 篇；“加载更多”复用本次结果，不重新调用嵌入。显示总数是这批安全去重后的文章数，并非整个远端索引的命中总数。150 ms 防抖、输入法组合阶段暂停、AbortController、15 秒超时与最新请求序号共同处理取消、超时和旧响应竞态。只有 HTTP 429、5xx、网络故障或内部超时会临时切换到 Pagefind，并显示“AI 搜索暂不可用，当前显示全文搜索结果”与“重试 AI 搜索”。取消或过时请求不会触发回退；“加载更多”沿用当前结果引擎，主动重试或新查询才重新尝试 AI Search。

静态 `/search/references.json` 只发布本次构建语料的 key、hash、canonical URL、标题、栏目与公开更新时间。它不包含正文、源文件路径或仓库 revision。搜索结果必须匹配该清单的 key、content hash 与站内 canonical URL；标题来自清单，远端 chunk 仅作为纯文本摘要，不能渲染 HTML。被版本校验排除的结果显示“正在更新”，不冒充索引没有匹配。该清单仅用于筛选，不会上传文章，也不是远端索引状态报告。

未设置 `PUBLIC_AI_SEARCH_URL` 时，仅 localhost / loopback 上的非 production 预览继续使用 Pagefind，便于离线开发。配置错误、除 429 外的 4xx、格式错误的成功响应，以及 production 或非本地 origin 缺少配置，均明确报错，不用 Pagefind 掩盖。临时故障回退使用构建时的公开全文索引，不依赖登录；最近更新仍由本地公开文章 metadata 生成，它列出的文章不代表已在 AI Search 中完成索引。

2026-09-10 已导入一批严格核验过的公开文章：原有 3 篇保留，新增 50 篇，其余导入暂停。截至当日最新 Cloudflare Dashboard，远端为 31 indexed、22 errors、53 total，queued 和 processing 均为 0。实际“Convex”查询与原文跳转已通过，但 TOTP 及部分问句仍返回上游 `7073`。索引错误为 capacity / timeout，尚无证据证明它们与查询 `7073` 是同一个根因；不能宣称服务持续稳定或全站全文 AI 索引已齐全。早期快照、实测过程和恢复边界见下文“本次实际执行结果”。匿名搜索及本轮迁移的 Convex 公共对话链路不需要 Cloudflare Account ID / API token；本地/CI 的 REST 文章同步和部署仍使用 `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`，不能全局删除这些凭据。

定向验证：`node --test tests/search-client.test.mjs tests/search-ai-client.test.mjs` 检查协议、白名单、恶意 URL、取消、重试与配置分支；`node tests/browser/search-ai.mjs` 使用本地隔离 fixture 验证真实 Command 的匿名请求、纯文本显示、竞态、快捷键和窄屏布局，不调用真实云端。

## 自定义域名与共享资源

开发与生产共用既有 AI Search 实例及其关联 Gateway，Clerk/Convex 的用户与数据环境仍分别隔离。`PUBLIC_AI_SEARCH_URL` 与 `AI_SEARCH_PUBLIC_URL` 可配置默认域名或已激活的自定义 HTTPS 域名，并必须使用同一 hostname；真实值只进入 Git 忽略的本地 env 与平台配置。校验器只接受可信部署配置，拒绝凭据、端口、IP/本地主机、额外路径及 URL 规范化绕过；请求拒绝重定向，文章 key、canonical URL、hash 校验保持。配置合法不等于域名已通过 Cloudflare 验证，仍需真实请求验收。

Cloudflare 的 Search 自定义域名保留 `/search` 与 `/chat/completions`；如果关闭默认域名，继续请求旧 hostname 会返回 `60018`，因此切换时须协调前端构建变量与 Convex 环境变量。生产构建平台变量和 production Convex 配置必须在实际发布时分别同步，本地 `.env.production.local` 不会自动改变平台。[Search 自定义域名](https://developers.cloudflare.com/ai-search/configuration/retrieval/public-endpoint/custom-domains/)

AI Gateway 自定义域名是另一个入口：用于直接 Gateway provider-native 或 `/compat/chat/completions` 请求，其 hostname 替代路径中的 account/gateway ID。当前 Convex 使用 AI Search 公共 Chat，由 Search 实例的既有关联选择 Gateway，不直接请求这个 Gateway 域名；不能把它填进 Search 配置。Gateway 的域名状态也不决定已经可用的 Search 自定义域名是否能回答。[Gateway 自定义域名](https://developers.cloudflare.com/ai-gateway/configuration/custom-domains/)

2026-09-10 按用户最终指定的 Search 自定义域名再次无凭据 probe：公开查询 Convex 返回 HTTP 200、8 chunks（约 4.1 秒），全部通过当前 key/hash/canonical/source-kind 校验，对应 1 篇文章；使用通过核验的 hash 限定公共 Chat 检索，收到 HTTP 200 SSE（约 1.1 秒），8 个来源 chunks 全部匹配、84 字回答及 `[DONE]`，模型继承实例设置。已同步 ignored 本地预览/生产构建 env 和 development `AI_SEARCH_PUBLIC_URL`，域名校验代码已部署 development；未改变生产云端配置。此项证明新域名的公共接口可用，不替代切换后站内登录、持久化和生产发布验收。

## 聊天入口与本地体验

全站右下角的圆形按钮打开博客助手，导航侧边栏不再提供聊天入口。交互参考 HeroUI Agents 的 sidebar 模式：桌面打开右侧整高栏，正文使用剩余空间，背景仍可滚动、交互，点击背景保持助手打开；小于 640px 时打开全屏模态面板，锁定背景滚动并限制键盘焦点。关闭按钮和 Esc 将焦点还给入口，收起保留本页草稿；新 AI 对话和消息由 Convex Agent 持久化，可在导航或刷新后从会话列表继续，未发送草稿不承诺跨页面保存。[官方 Appearance 规范](https://heroui.pro/docs/agents/configure/appearance)

首屏只输出原生按钮和轻量控制脚本，首次点击再加载 React 与 HeroUI Pro 聊天组件。面板使用原生 dialog，让加载失败时仍可关闭和重试，同时保留收起后的 React 状态。窄屏高度跟随可视视口，避免软键盘盖住输入区。登录、AI 对话、收藏、咨询和会员都从右下圆圈进入。尚未上线的 `/chat/` 与 `/me/` 开发页面已经删除，无需兼容跳转，也不进入 sitemap。文章评论保留正文页内入口。

HeroUI Agents SDK 是独立的托管产品；本站仅参考其交互规范。助手面板使用 Convex Agent 保存会话和生成状态，Clerk 登录后才能读写。新对话链路在对应 Convex deployment 配置 `AI_SEARCH_PUBLIC_URL`，指向浏览器 `PUBLIC_AI_SEARCH_URL` 使用的同一公开实例，由后端调用 `/chat/completions`；不再要求先经 Worker 检索桥、配置 Cloudflare 模型调用凭据或固定旧 Qwen 模型。Convex 仍校验会话归属与当前公开引用的 key、canonical URL、content hash；浏览器不能提交模型、Gateway、自定义系统提示或其他用户的历史。公共 endpoint 本身没有 Clerk 鉴权，不替代站内权限检查。development 已通过首问、追问、刷新恢复及旧失败会话重试，核验了每轮来源与持久化状态，生产配置与部署未改动；配置和边界见 [账户服务](member-services.md#验收与发布)。旧 `/api/chat/` 代码保留且继续校验 Clerk session JWT，当前助手前端不调用它。[HeroUI Agents 概览](https://heroui.pro/docs/agents)

本轮最终 development 实测：新会话首问 3.424 秒、追问 7.737 秒，均为 completed 且各有 2 个来源；刷新后两轮完整回答及 4 个引用入口恢复。保留原失败记录的旧会话再次提问，也在 3.696 秒完成并返回 2 个来源。生成上下文只使用同一账户、同一会话的完整成功问答，失败和取消轮次不再替代原话题；失败会先持久结算，再进入 Agent SDK 清理，避免等待 120 秒才显示结果。34 项定向测试与 Convex 类型检查通过。这是已测路径的结果，不代表上游错误或索引覆盖问题已全部消失。

以下仅描述保留的旧 Worker 路径，不是新 Convex 对话的配置步骤：`npm run dev` 通过 `scripts/lib/chat-dev.mjs` 的 Vite 插件处理 `/api/chat/`，复用 `worker/chat.mjs`，无需另外运行 `dev:worker`。适配器在请求通过格式与来源校验后才加载云端绑定。`getPlatformProxy` 根据 `wrangler.jsonc` 中的 `remote: true` 配置连接既有 AI Search 实例与 Workers AI。[Wrangler 编程接口](https://developers.cloudflare.com/workers/wrangler/api/)、[AI Search Workers binding](https://developers.cloudflare.com/ai-search/api/search/workers-binding/)

显式联调旧 Worker remote binding 时，Wrangler OAuth 登录需要 `ai:write`、`ai-search:write` 和 `ai-search:run` 权限；重新登录时也要保留既有 Worker 发布所需的 scopes。新 Convex 公共 endpoint 链路不依赖这套本机绑定登录。文章同步 CLI 仍要求显式设置 `CLOUDFLARE_API_TOKEN`，不会自动使用 Wrangler OAuth；重新登录 Wrangler 不会自动满足同步 CLI 的 token 要求，详见下文“认证和 API”。

2026-09-08 本地验收针对当时的 Worker 聊天链路：Wrangler OAuth 权限、真实 AI Search 检索、经唯一 Gateway 的固定模型生成、流式回答和文章引用已打通。这不代表随后改用的 Convex Agent 链路已通过真实验收。首次仅索引了下文列出的三篇公开样本，全量文章同步和生产发布尚未执行。入口不会生成演示回答；权限不足或连接失败时显示错误，检索不到有效资料时明确说明依据不足。`npm run test:browser:chat` 的合成流只注入测试浏览器，用于验证引用、停止、错误和限流提示；真实云端验收另外发送公开文章问题完成。

2026-09-09 只读复核：既有 AI Search 实例的内置存储仍只有三篇样本，状态均为 `completed`；本地导出的 878 篇文章并未全量上传。三篇远端 key 均在当前本地引用清单中，但只有一篇的 `content_hash` 匹配；另两篇即使被搜索命中，也会被当前版本校验排除。远端没有 Convex 文章。`completed` 只证明远端该版本已索引，不证明它与当前构建一致，更不证明完整 RAG 可用；不应通过去掉 hash 校验来掩盖语料版本差异。

查看实际数据时，在 Cloudflare AI Search 的 `tcitry-blog-search` 实例中检查 Items 的数量、状态和 metadata，再核对本地引用清单。模型生成请求另在 AI Gateway `tcitry-blog-chat` 的 Logs 查看；AI Search 的检索嵌入请求和聊天生成请求须按模型区分。Convex 会话与失败状态的验证入口见 [账户服务验收](member-services.md#验收与发布)。

## 控制台配置

在 AI Search → `tcitry-blog-search` → Settings 中核对：

| 配置 | 本站值或起始建议 |
| --- | --- |
| AI Gateway | `tcitry-blog-chat` |
| 数据源 | 内置存储，不再为同批文章添加 Website 或 R2 |
| Embedding model | 保持 `@cf/qwen/qwen3-embedding-0.6b` |
| Chunk size / overlap | 保持 1,024 tokens / 10%，用真实中文问题评估后再调 |
| Vector search / keyword search | 按现有实例及实际请求设置核验召回；旧 Worker 的 Vector 设置不作为新公共对话链路的固定要求 |
| Query rewriting / reranking | 首轮建议关闭，先测原始检索，减少每问模型调用次数 |
| Public endpoint | 左侧匿名搜索调用 `/search`；Convex Agent 调用同一实例的 `/chat/completions`，聊天权限仍由本站后端校验；development 已通过真实生成，生产未部署本轮改动 |
| Similarity caching | 首轮关闭，便于验证刚发布的内容和检索质量 |

本轮公共对话链路的回答模型默认继承 AI Search 实例设置；Convex 不再固定传入旧 Qwen 模型或 Gateway，浏览器也不提供模型列表、选模或自定义系统提示。旧 `worker/chat.mjs` 保留的固定模型设置只属于旧 `/api/chat` 路径，不能据此判断新 Convex Agent 的实际回答模型。本轮已验证公共对话路径真实生成；具体回答模型名称仍以实例配置及请求日志为准，不能由旧代码推断。

实例中的 embedding 与回答模型承担不同职责；修改回答模型不应把 embedding 请求强制路由到聊天模型。保留实例与既有 Gateway 的关联，不为这次迁移创建第二个 Gateway。

Custom Metadata 配置以下五个字段。上传前同步脚本会检查字段名称和类型；缺少字段时停止，不会带着不完整的 schema 上传。Cloudflare 的五字段限制、修改 schema 会重新索引等行为见[元数据文档](https://developers.cloudflare.com/ai-search/configuration/indexing/metadata/)。

| Field name | Data type | 作用 |
| --- | --- | --- |
| `canonical_url` | `text` | 已发布的文章 URL |
| `section` | `text` | `docs`、`posts` 或 `weekly` |
| `updated_at` | `datetime` | 正文的公开更新时间；未知时不上传该值 |
| `source_kind` | `text` | `author` 或 `ai-assisted`，保留 ByAI 的来源边界 |
| `content_hash` | `text` | 导出文档的 SHA-256，避免重复索引并识别旧版本 |

标题已在文档首行和构建生成的引用清单中，不再占一个远端 metadata 字段。调用方应从当前部署的引用清单取标题与链接，不能采用模型编造的 URL。

## 分层控制与单 Gateway 的取舍

当前建议 Gateway 的 **Rate limiting 先关闭、Caching 关闭**。用户已选择保留单个 Gateway，后续可以开启共享的网关限流，无需新建另一个 Gateway。AI Search 会通过关联 Gateway 调用嵌入等模型；Cloudflare 建议避免在该 Gateway 限流，因为它也可能打断索引和查询。这是共享限额的运行取舍，并非技术上必须拆分 Gateway。[AI Search 与 Gateway](https://developers.cloudflare.com/ai-search/configuration/models/ai-gateway/)

| 层次 | 控制内容 | 当前配置 / 后续建议 |
| --- | --- | --- |
| 聊天界面 | 登录后同一会话只生成一条回答，支持停止并保留输入 | 默认 |
| 旧 Worker 输入/输出 | `/api/chat` 每问 2,000 字、最近四轮完整问答、请求体 32 KiB、输出 2,048 tokens | 仅保留路径；新 Convex Agent 以实际后端校验为准 |
| Worker Rate Limiting binding | 只在 `/api/chat` 检索前按已登录用户的哈希 key 限制提交频率 | 暂未配置。后续可从 10 次 / 60 秒开始 |
| 文章同步 | 串行上传，每篇完成索引后再上传下一篇；API 请求至少间隔 1 秒 | 默认 |
| AI Gateway Rate limiting | 统一限制这个 Gateway 的模型调用，索引和聊天共享 | **关闭** |
| AI Gateway Caching | 缓存模型响应；AI Search 嵌入使用该 Gateway | **关闭** |
| AI Search Public endpoint 的 Rate limiting | 具体窗口与额度以实例设置为准 | 左侧匿名搜索及新 Convex 对话经过此入口；搜索遇到 429 显示全文回退提示，对话保留可恢复失败；旧 Worker binding 不经过此入口 |
| WAF Rate limiting rule | 根据域名和 HTTP 路径在 Worker 前拦截请求 | 首版不新增，避免与 Worker 入口规则重复维护 |
| 平台/模型配额 | Cloudflare 或模型服务自身的速率与容量限制 | 仍然生效，关闭自定义限流不能关闭平台配额 |

Gateway 的计数单位是模型调用，不是独立访客或提问。一次提问可能触发查询嵌入和回答生成；文章索引也消耗同一份额度。若后续启用网关限流，应参考首次索引和访问峰值，留出维护余量；不要直接把“每分钟访客提问数”当作网关阈值。Worker 的访客控制是另一层措施，不等于 Gateway 限流已经启用。

后续开 Gateway 限流的配置起点：先记录首次索引及日常问答的 60 秒模型请求峰值，以峰值约两倍试运行，窗口选择 **sliding / 60 秒**。例如实测峰值 40 次，才考虑从 **100 次 / 60 秒**开始。这是工程起点，不是 Cloudflare 官方推荐阈值；文章索引或查询出现 429 时应提高阈值或关闭，并重新运行失败的同步。

若后续需要维护旧 `/api/chat` 入口的限流，可在 `wrangler.jsonc` 加以下顶层配置并重新部署，代码已有 `CHAT_RATE_LIMIT` 分支；它不控制当前 Convex 助手请求：

```json
{
  "ratelimits": [{
    "name": "CHAT_RATE_LIMIT",
    "namespace_id": "2026090801",
    "simple": { "limit": 10, "period": 60 }
  }]
}
```

选择一个本账户未被其他限流绑定共用的 `namespace_id`。旧 `/api/chat` 对已验证的 Clerk 用户标识做 SHA-256 后作为 key，不将用户标识放入模型 metadata 或应用日志；计数按 Cloudflare location 最终一致，不能承诺全球精确的“每个人十次”。新 Convex Agent 的提问和创建会话通过 Convex rate-limiter 在后端控制，详见当前 `convex/assistant.ts`。本配置不创建新 Gateway。

如果改用 WAF，规则只匹配主域的 `POST /api/chat` 与 `POST /api/chat/`，不要对所有博客路径限流；WAF 可用阈值和时间窗口随套餐而异，按控制台提供项设置即可，不必同时开启 Worker 和 WAF 两套相同规则。

官方依据：[Gateway 限流](https://developers.cloudflare.com/ai-gateway/features/rate-limiting/)、[Search 公共入口](https://developers.cloudflare.com/ai-search/configuration/retrieval/public-endpoint/)、[Worker 限流 binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)、[WAF 计数范围](https://developers.cloudflare.com/waf/rate-limiting-rules/request-rate/)、[Gateway 平台限制](https://developers.cloudflare.com/ai-gateway/reference/limits/)。支出上限是另外的金额控制，不等于请求频率限制。

同步 REST 请求遇到 HTTP 429 时最多尝试四次，优先遵守 `Retry-After`；没有该头时使用 2、4、8 秒的退避。服务器要求等待超过 60 秒时停止本轮，避免提前重试。单篇索引状态最多轮询约两分钟；仍未完成或返回错误时，本轮不记录成功、不继续删除文章。索引后台任务发生的限流可能表现为 Items 中的错误，需要待限额恢复后重新运行同步。聊天应把 429 转成“请求较多，请稍后再试”的可恢复提示，而不是连续重发。

## 公开内容如何导出

`ai-search:export` 读取本次构建的 `.generated/content.json`，只选 `page.kind === 'page'` 且 `type` 为 `docs`、`posts`、`weekly` 的页面。草稿、隐藏、跳转、`bookSearchExclude`、空正文以及分区和业务索引页均被排除。

正文复用已渲染的 `page.html`，通过 HTML 解析器转换为 Markdown：保留标题层次、正文、列表、表格、公开链接、代码和代码中的空行，去掉脚本、复制按钮、导航、隐藏 UI 和演示包装组件。ByAI 标签会在导出正文中写成明确的来源声明；文章里的 quote 提示也随正文一并导出。

不会上传整个 `BLOG_DIR`、Markdown 源文件或原始 `content.json`。`source`、完整 frontmatter、私有检出路径、渲染诊断均不进入导出清单。所有导出文件位于已忽略的 `.generated/`，不得提交到 Git，也不复制到 `dist/` 作为可下载的完整语料包。

生成文件的职责：

| 文件 | 内容和用途 |
| --- | --- |
| `.generated/ai-search/documents/<id>.md` | 单篇已公开正文和少量元数据，供同步上传 |
| `.generated/ai-search/references.json` | 当前部署可信的引用白名单：URL、显示标题、版本 hash 等；同次构建供 Convex Agent、公开 `/search/references.json` 和保留的 Worker 路径使用，不含正文 |
| `.generated/ai-search/manifest.json` | 引用清单、生产/预览标记、站点和内容提交、语料 hash |
| `.generated/ai-search-sync.json` | 本轮完整同步成功后的记录，失败不推进 |

`id` 为正式 canonical URL 的 SHA-256，远端 key 为 `tcitry-blog/articles/<id>.md`。正文更新时覆盖同一 key；URL 变化时新增新 key，旧 key进入删除清单。内容 hash 包含公开标题、日期、来源声明和正文，不包含检出路径或同步时间，因此相同的公开内容不会因为换发布目录而重复上传。

## 首次在本地体验：只导入三篇公开样本

首次实例为空时，可以在不部署站点的情况下使用 `ai-search:bootstrap`。它固定选择 **Contract Testing、Git 基本使用、DataStore** 三篇，不接受任意文件或 URL 参数。

```sh
npm run ai-search:bootstrap
npm run ai-search:bootstrap -- --apply
npm run dev
```

第一条默认 dry-run：读取当前导出，在网上逐篇核对 HTTP 200、无跳转、canonical、显示标题、正文及 sitemap 更新时间，再验证文档字节的 SHA-256 等于本地可信引用清单。默认不会启动 Cloudflare binding。缺少导出时先运行 `npm run prepare:content`；该入口允许 preview 导出，但只有与当前公开页面完全匹配的三篇样本可以进入下一步。

第二条才通过已安装 Wrangler 的 `unstable_dev()` 启动临时本地 Workers 运行时，并使用配置中的 remote binding 连接现有 `tcitry-blog-search`。本地桥仅接受带随机会话标识的有限 JSON 操作，结束后关闭，不部署任何 Worker。Wrangler 管理既有 OAuth 登录；本次三篇样本导入无需另设 `CLOUDFLARE_API_TOKEN`，脚本不读取凭据文件。它核对单 Gateway 关联、内置数据源和完整对象列表；schema 为 null 时仅补上本文约定的五字段，已有非空 schema 不同则停止。仅新增不存在的样本 key，相同 hash 已存在时等待或跳过，不覆盖不同 hash，不删除任何文章。每篇上传前再次核对线上正文和远端 key，上传后等待索引完成。

该命令不执行生产构建、站点发布、全量同步，也不创建或修改生产发布回执。正式发布仍采用下一节的封存流程，生产全量同步 `ai-search:sync` 仍要求显式设置 `CLOUDFLARE_API_TOKEN`。首次导入期间不要同时从其他目录上传相同 key；绑定上传与检查不是跨请求的原子事务。

当前锁定 Wrangler 没有 `ai-search items upload` 命令；这里在实际 Workers 运行时内部调用官方 `items.list()`、`items.uploadAndPoll()`，配置更新使用实例 `update()`。Node 侧通过受限 JSON 桥调用它们；不直接使用 `getPlatformProxy` 访问嵌套的 `items.*`，因为当前 Node 代理不能保留这一嵌套 RPC 路径。代码提供可注入 binding 的 `bootstrapAISearch()`，便于复用已建立的官方连接和执行离线测试。[Wrangler 编程接口](https://developers.cloudflare.com/workers/wrangler/api/)、[Items binding](https://developers.cloudflare.com/ai-search/api/items/workers-binding/)、[实例 binding](https://developers.cloudflare.com/ai-search/api/instances/workers-binding/)

### 扩大已发布内容覆盖：只新增

```sh
npm run ai-search:bootstrap -- --published-only --dry-run
# 审阅新文章、冲突和未核验数量后，再执行写入：
npm run ai-search:bootstrap -- --published-only --apply
```

`--published-only` 遍历当前导出，但只允许与生产 HTML 和 sitemap 一致的文章：核对 canonical、实际标题、正文、公开日期、栏目、ByAI 标记与内容 hash。检查不通过只表示本轮无法证明一致，不据此判定文章尚未发布，也不放松 Posts / Weekly 的正文比对规则。dry-run 通过同一临时 binding 只读查询实例和所有来源的完整分页；运行时禁止上传及修改配置。原命令不带该参数时仍固定三篇样本。

apply 要求实例已具有完全一致的五字段 schema，绝不初始化或修改 schema；任何来源已占用的 key 都不会上传，同 key 不同 hash、状态未完成或 metadata 不同均单独报告。Cloudflare 返回的 `datetime` metadata 使用 epoch 毫秒时，只接受与原 ISO 日期完全相同的时刻。每 50 篇为一批，在批前后完整读取所有来源的库存并核验 schema；批前刷新 sitemap，批内每篇写前重新读取当前 HTML、检查本地快照与文档 hash，并对照本批 sitemap 和已知 key 集合。批次串行，批内最多并发处理三个不同的唯一 key，已提交 key 立即加入集合，不与分页或状态查询并发。

`items.upload()` 立即返回 id/key；批后用完整库存核验自己提交的 id、key、metadata 和状态，全部批次结束后仅对仍未完成的条目调用 `items.get(id).info()`。只有全部完成才报告成功。没有无依据的逐篇固定等待；索引失败、限流或读取不确定时停止领取新工作，等待已开始请求结束并记录已确认与不确定数量，保留已提交内容，不盲目重试上传、删除或回滚。

执行期间必须让该进程独占实例写入，包括其他检出目录和控制台操作：本地锁仅能阻止同一目录并发，官方 Items API 没有文档化的条件创建参数。列表只使用官方支持的排序；发生分页重排时最多重新读取完整列表三次，仍不一致则停止。若中断后锁仍存在，先确认原进程已结束；再次 dry-run 检查当前状态，再处理剩余项。此入口不改 `dist/`，不生成生产发布回执，也不替代后续受发布回执约束的完整同步。

### 本次实际执行结果（2026-09-10）

本次 dry-run 和 apply 的逐篇公开性核验使用同一份构建快照。878 篇导出中，635 篇通过严格核验：632 篇远端不存在，Git 基本使用 1 篇已存在且 hash 一致，Contract Testing 与 DataStore 2 篇已存在但 hash 不同，按保护规则保留。另有 243 篇未通过本轮核验而排除：218 篇正文不一致、18 篇 SEO 标题不一致、6 篇请求发生跳转、1 篇公开修改日期不一致。排除表示当前证据不足，不等于这些文章都未上线；本次未放松 Posts / Weekly 正文或元数据规则。

`--published-only --apply` 在第一批收到 50 次新增上传的确认后，因真实索引错误停止；没有不确定的上传结果，其余 582 篇尚未上传。首次导入结束时，只读完整分页与 metadata 复核得到以下历史快照：

| 范围 | 数量与状态 | 核验结果 |
| --- | --- | --- |
| 原有样本 | 3 篇，均 `completed` | 本次未向这些 key 发送任何写入；Git 匹配当前 hash，另两篇仍保留原版本 |
| 本次新增 | 19 篇 `completed` | key 和 `content_hash` 均匹配本次导入快照 |
| 本次新增 | 31 篇 `error` | key 和 `content_hash` 均匹配本次导入快照；30 个 `workers_ai_out_of_capacity_error`、1 个 `workers_ai_timeout_error` |
| 远端总计 | 53 篇：22 `completed`、31 `error` | 读取时没有 `queued` / `running` 条目，失败条目的 `next_action` 均为 `null` |

该次读取中实例未暂停，Embedding model 仍为 `@cf/qwen/qwen3-embedding-0.6b`，Gateway 关联和五字段 schema 保持原样。本次没有覆盖、删除、重新上传失败条目，也没有变更模型、配置、凭据权限或部署站点。官方将这两个错误分别解释为 Workers AI 容量不足与请求超时；最后一次读取没有发现已安排的后续动作，不能声称后台正在自动重试。[索引错误码](https://developers.cloudflare.com/ai-search/troubleshooting/indexing-error-codes/)

对新增且 `completed` 的 Kubernetes 调度、TanStack Query 与 MDX 入门三篇文章，按当前前端请求格式匿名调用 Public `/search`，三次均返回 HTTP 500。`completed` 只证明对应版本完成索引，本轮没有取得这三次查询的成功返回，不能把新增的 19 篇称为已通过真实搜索验收，也不能仅凭 HTTP 500 判定与索引失败是同一个根因。

同日稍后，最终构建的实际页面查询“Convex”获得两条经过当前引用清单验证的 AI Search 结果，点击《以 ClawHub 为例：如何在真实流量下优化 Convex》正常打开原文；该次没有启用 Pagefind 回退。临时故障回退、重试恢复、取消与分页一致性另通过 24 项定向单元测试及 1440px / 320px 浏览器 fixture。上表保留该次导入的错误快照；未因单次查询恢复就继续批量写入。

截至 2026-09-10 最新 Cloudflare Dashboard，53 个条目中为 **31 indexed、22 errors**，queued 和 processing 均为 0。此快照与首次导入结束时的 22 `completed` / 31 `error` 不同，不能继续把早期错误数当作当前值。索引错误仍为 capacity / timeout，尚未证明全量公开文章已完成索引。

同日较早阶段，公共对话新链路已部署到 Convex development，并在真实登录页面完成首问 Convex 的完整回答和一篇核验来源；刷新后恢复回答与引用，再追问“它和 Durable Objects 有什么区别？”仍得到完整回答和该轮引用。对应 `AI_SEARCH_PUBLIC_URL` 已配置，四个旧 Convex 运行时变量已移除；移除后从真实登录页面再次提问 Convex，仍得到完整回答及来源。生产环境未改动。详细测试与环境边界见 [账户服务验收](member-services.md#验收与发布)。实际上游仍有 TOTP 及部分问句返回 `7073`，不能从索引 capacity / timeout 错误直接推定查询失败的根因，也不能把成功问答推广为所有查询稳定可用。

查看或人工处理时，进入 [Cloudflare 控制台](https://dash.cloudflare.com/) → **AI → AI Search → `tcitry-blog-search` → Items**，检查失败条目的状态、错误及 metadata。官方确认这里可查看和管理文件；本轮未核验控制台是否提供单条或批量重试按钮，因此不记录未经证实的按钮路径。[Items 控制台说明](https://developers.cloudflare.com/ai-search/configuration/data-source/built-in-storage/#upload-and-manage-files)

官方单条重新索引 API 为 `PATCH /accounts/{account_id}/ai-search/namespaces/{name}/instances/{id}/items/{item_id}`，请求体为 `{"next_action":"INDEX","wait_for_completion":true}`。它针对已存条目，不需要重新上传正文。首次导入复核阶段只核验了文档，没有执行该操作：现有 REST token 的先前只读请求返回 403，当前官方 Workers binding 与锁定的 Wrangler CLI 未提供对应调用入口；不读取 Wrangler 认证文件、不扩大 token 权限或猜测 API。恢复前需先具备已授权且可用的正式调用方式，核对目标是本次新增且 hash 一致的失败条目，从单篇开始验证；剩余 582 篇继续暂停。[单条 Sync API](https://developers.cloudflare.com/api/resources/ai_search/subresources/namespaces/subresources/instances/subresources/items/methods/sync/)

上传入口的定向回归已通过：24 项 bootstrap、只新增导入和本地桥测试，加上 10 项语料与同步测试。覆盖现有 key 保护、严格 metadata、公开页面核验、完整分页、快照变化、并发停止后等待已开始请求结束及无盲目重传。临时本地 Workers 运行时均随检查结束关闭，导入进程已退出并释放本地锁；这些验证不代表云端搜索恢复或生产发布完成。

## 发布与同步流程

所有入口维护在 `package.json`。本地可以先查看导出，不进行远端写入：

```sh
npm run prepare:content
npm run ai-search:sync
```

没有 Cloudflare 环境变量时，最后一条只报告本地文章数。有 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN` 时，默认读取远端完整分页，计算上传、等待、未变和删除数量，仍不改变远端状态。

正式发布继续使用独立站点检出、独立依赖与缓存、独立 `dist/` 和固定的已审查内容提交。顺序为：生产构建 → 生产验证 → 封存产物与语料 → 上传封存产物 → 线上核验 → 同步文章。

```sh
npm run build:production
npm run verify:release
npm run deploy:verified
```

`deploy:verified` 已包含同步：发布前检查显式 token、远端实例配置与完整分页，并读取目标 Convex production 的 `AI_SEARCH_PUBLIC_URL`，验证它与封存的 `PUBLIC_AI_SEARCH_URL` 指向同一公共实例（origin、`/search` 或 `/chat/completions` 可归一化为等价地址）；缺少、非法或不一致时在部署前停止，不自动写入配置，也不输出原始配置值；发布后完成既有全站线上检查，核对 `/blog-release.json` 中的生产版本和 `/api/chat` 路由，再写部署回执并执行 `--apply`。环境中的 `BLOG_DIR` 必须指向已审查的独立内容检出，`BLOG_CONTENT_COMMIT` 固定对应提交。不要在生产发布目录重建，或从其他任务仍可能写入的共享 `dist/` 上传。

若站点已发布而线上核验/同步失败，修复原因后在同一封存目录重试：

```sh
npm run verify:deployment
npm run ai-search:sync -- --apply
```

首次配置前需要在运行环境设置 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`。因为同一发布命令使用 Wrangler 和 AI Search REST，token 必须同时包含该账户既有 Worker 发布权限及 AI Search Edit / Run；限制在目标账户。仅 `wrangler login` 的 OAuth 登录不能自动给此同步脚本提供 token。不要把 token 值放进聊天或命令历史，使用本机安全注入或 CI secret。

`--apply` 会在发送任何远端写入前同时校验：

1. 现有生产 release seal 仍有效，站点、主题、Wrangler 配置和 `dist/` 未改变。
2. 语料声明为 production；站点/内容提交与 release 相同；每篇文章都存在于封存的生产页面清单中。
3. 所有 Markdown 字节、引用白名单和 corpus manifest 的哈希等于发布时封存的 `release.aiSearch`。
4. `.generated/deployment.json` 的 `releaseHash` 对应原始 `release.json` 字节，且记录了成功的线上核验时间。

预览产物、未发布产物、旧发布回执和空语料都不能进入正式同步。不要为了通过这些检查手工制造回执；回执应由发布后的线上核验流程生成。

同步仅管理 builtin 数据源中符合本站完整 key 格式的对象，不会删除手工上传的其他文件或外部数据源内容。新增和更新文章全部索引完成后，才删除不再公开的旧文章，并确认它们已经从 Items 消失。远端分页总数变化、重复项、哈希不一致、429 耗尽重试或索引未完成都会使同步停止，不会把部分操作标成完整成功。已成功上传的文章保留，下次运行读取远端 hash 后继续；不需要复制上次发布目录里的本地状态文件。

撤回文章在本次构建的引用白名单中会消失；即使远端删除尚在排队，搜索和聊天也不能展示未通过当前白名单校验的引用。正文更新到索引生效之间可能暂时没有足够资料，界面应明确表示公开文章中未找到充分依据。

## 认证和 API

同步 CLI 只读取显式的 `CLOUDFLARE_API_TOKEN` 环境变量，不扫描浏览器、系统钥匙串、Wrangler 登录文件或其他项目的凭据。Token 按 Cloudflare 文档授予目标账户的 AI Search Edit 和 Run 权限，在运行同步的环境中设置，不写入仓库、不放进前端环境变量。API 响应中的任意错误正文不会原样打印，日志只包含状态码、错误代码和文章数量。[Items REST API 认证](https://developers.cloudflare.com/ai-search/api/items/rest-api/)

经明确授权的调用方也可通过 `syncAISearch({ client })` 注入客户端；`createAISearchClient({ authorize })` 接收返回请求头的回调，凭据提供方式由调用方负责，业务同步代码不读取本机认证存储。

当前实现使用 namespace 路径下的 Items API，上传使用 multipart 的 `file`、`metadata` 和 `wait_for_completion`；列举使用 `page`、`per_page=50`、`source=builtin`。上传成功并不总表示已可查询，因此脚本继续检查 Items 状态。[上传 API](https://developers.cloudflare.com/api/resources/ai_search/subresources/namespaces/subresources/instances/subresources/items/methods/upload/)、[分页 API](https://developers.cloudflare.com/api/resources/ai_search/subresources/namespaces/subresources/instances/subresources/items/methods/list/)

## 验证

`npm test` 包含 `tests/ai-search-*.test.mjs` 的合成测试：公开过滤、ByAI 标识、代码空行保留、URL/key/hash、发布语料封存、分页、删除范围、429 退避，以及索引失败不推进删除与完成状态。

上线验收还需在真实实例验证普通中文提问、技术名词、跨文章问题、找不到依据、来源卡片与原文链接，并验证停止生成和 429 提示。测试问题与样本只使用已公开文章。首次索引后查看 Items、Gateway 日志和检索返回质量，再决定是否开启共享 Gateway 限流及具体阈值。
