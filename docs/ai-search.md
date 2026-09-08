# 博客助手的文章索引与发布同步

本站只使用一个 AI Gateway `tcitry-blog-chat`。AI Search 实例 `tcitry-blog-search` 位于 `default` namespace，继续关联这个 Gateway；运行时检索与回答生成共用它。文章使用 AI Search 内置存储，发布脚本通过 REST API 上传，站点 Worker 使用 binding 查询。Binding 不会自动监视 Git 仓库或上传本地文件，也无需另外创建 R2 bucket 或网站爬虫。[Cloudflare 内置存储说明](https://developers.cloudflare.com/ai-search/configuration/data-source/built-in-storage/)

## 聊天入口与本地体验

全站右下角的圆形按钮打开博客助手，侧边栏不再提供聊天入口。交互参考 HeroUI Agents 的 floating 模式：桌面打开右下角面板，背景仍可滚动、交互，点击外部或按 Esc 收起；小于 640px 时打开全屏模态面板，锁定背景滚动并限制键盘焦点。关闭按钮和 Esc 将焦点还给入口，收起保留本页对话和草稿，导航或刷新页面后清空。[官方 Appearance 规范](https://heroui.pro/docs/agents/configure/appearance)

首屏只输出原生按钮和轻量控制脚本，首次点击再加载 React 与 HeroUI Pro 聊天组件。浮层使用原生 dialog，让加载失败时仍可关闭和重试，同时保留收起后的 React 状态。窄屏高度跟随可视视口，避免软键盘盖住输入区。`/chat/` 保留为使用说明页，不再渲染第二份聊天组件。

HeroUI Agents SDK 是独立的托管产品；本站仅参考其交互规范，消息仍发送到自己的 `/api/chat`，沿用既有 AI Search 与单个 AI Gateway。[HeroUI Agents 概览](https://heroui.pro/docs/agents)

`npm run dev` 可以直接体验上述真实界面。普通 Astro dev 尚未代理 Worker API；真实回答还需要接通本地 Worker、配置远端访问权限并完成首轮索引。此入口不会生成演示回答。`npm run test:browser:chat` 的合成流只注入测试浏览器，用于验证引用、停止、错误和限流提示，不代表云端链路已验收。

## 控制台配置

在 AI Search → `tcitry-blog-search` → Settings 中核对：

| 配置 | 本站值或起始建议 |
| --- | --- |
| AI Gateway | `tcitry-blog-chat` |
| 数据源 | 内置存储，不再为同批文章添加 Website 或 R2 |
| Embedding model | 保持 `@cf/qwen/qwen3-embedding-0.6b` |
| Chunk size / overlap | 保持 1,024 tokens / 10%，用真实中文问题评估后再调 |
| Vector search / keyword search | 首版 Worker 明确使用 Vector；保留向量索引。中文和技术词召回评估后再考虑 Hybrid |
| Query rewriting / reranking | 首轮建议关闭，先测原始检索，减少每问模型调用次数 |
| Public endpoint | 关闭，读者经本站 Worker 访问 |
| Similarity caching | 首轮关闭，便于验证刚发布的内容和检索质量 |

生成模型在 `worker/chat.mjs` 固定为 `@cf/qwen/qwen3-30b-a3b-fp8`，每次生成明确指定 Gateway `tcitry-blog-chat`，最大输出 2,048 tokens。AI Search 只做检索，不调用它自带的回答生成接口。浏览器不能提交模型、Gateway 或自定义系统提示。

**固定聊天模型不等于把网关中的所有请求都改成这个模型。** 嵌入继续使用 `@cf/qwen/qwen3-embedding-0.6b`；不要用 Gateway 路由规则将 embedding 强制改写成聊天模型。[固定生成模型](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)

Custom Metadata 配置以下五个字段。上传前同步脚本会检查字段名称和类型；缺少字段时停止，不会带着不完整的 schema 上传。Cloudflare 的五字段限制、修改 schema 会重新索引等行为见[元数据文档](https://developers.cloudflare.com/ai-search/configuration/indexing/metadata/)。

| Field name | Data type | 作用 |
| --- | --- | --- |
| `canonical_url` | `text` | 已发布的文章 URL |
| `section` | `text` | `docs`、`posts` 或 `weekly` |
| `updated_at` | `datetime` | 正文的公开更新时间；未知时不上传该值 |
| `source_kind` | `text` | `author` 或 `ai-assisted`，保留 ByAI 的来源边界 |
| `content_hash` | `text` | 导出文档的 SHA-256，避免重复索引并识别旧版本 |

标题已在文档首行和 Worker 引用清单中，不再占一个远端 metadata 字段。调用方应从当前部署的引用清单取标题与链接，不能采用模型编造的 URL。

## 分层控制与单 Gateway 的取舍

当前建议 Gateway 的 **Rate limiting 先关闭、Caching 关闭**。用户已选择保留单个 Gateway，后续可以开启共享的网关限流，无需新建另一个 Gateway。AI Search 会通过关联 Gateway 调用嵌入等模型；Cloudflare 建议避免在该 Gateway 限流，因为它也可能打断索引和查询。这是共享限额的运行取舍，并非技术上必须拆分 Gateway。[AI Search 与 Gateway](https://developers.cloudflare.com/ai-search/configuration/models/ai-gateway/)

| 层次 | 控制内容 | 当前配置 / 后续建议 |
| --- | --- | --- |
| 聊天界面 | 同一会话只生成一条回答，支持停止并保留输入 | 默认 |
| Worker 输入/输出 | 每问 2,000 字、最近四轮完整问答、请求体 32 KiB、输出 2,048 tokens | 默认；这是单次请求边界，不是频率限流 |
| Worker Rate Limiting binding | 只在 `/api/chat` 检索前按代码提供的 key 限制提交频率 | 暂未配置。后续可从 10 次 / 60 秒开始 |
| 文章同步 | 串行上传，每篇完成索引后再上传下一篇；API 请求至少间隔 1 秒 | 默认 |
| AI Gateway Rate limiting | 统一限制这个 Gateway 的模型调用，索引和聊天共享 | **关闭** |
| AI Gateway Caching | 缓存模型响应；AI Search 嵌入使用该 Gateway | **关闭** |
| AI Search Public endpoint 的 Rate limiting | 所有启用公共端点共享，默认 fixed / 120 次每分钟 | **关闭整个 Public endpoint**；Worker binding 不经过这一公共入口 |
| WAF Rate limiting rule | 根据域名和 HTTP 路径在 Worker 前拦截请求 | 首版不新增，避免与 Worker 入口规则重复维护 |
| 平台/模型配额 | Cloudflare 或模型服务自身的速率与容量限制 | 仍然生效，关闭自定义限流不能关闭平台配额 |

Gateway 的计数单位是模型调用，不是独立访客或提问。一次提问可能触发查询嵌入和回答生成；文章索引也消耗同一份额度。若后续启用网关限流，应参考首次索引和访问峰值，留出维护余量；不要直接把“每分钟访客提问数”当作网关阈值。Worker 的访客控制是另一层措施，不等于 Gateway 限流已经启用。

后续开 Gateway 限流的配置起点：先记录首次索引及日常问答的 60 秒模型请求峰值，以峰值约两倍试运行，窗口选择 **sliding / 60 秒**。例如实测峰值 40 次，才考虑从 **100 次 / 60 秒**开始。这是工程起点，不是 Cloudflare 官方推荐阈值；文章索引或查询出现 429 时应提高阈值或关闭，并重新运行失败的同步。

若后续先启用博客入口限流，可在 `wrangler.jsonc` 加以下顶层配置并重新部署，代码已有 `CHAT_RATE_LIMIT` 分支：

```json
{
  "ratelimits": [{
    "name": "CHAT_RATE_LIMIT",
    "namespace_id": "2026090801",
    "simple": { "limit": 10, "period": 60 }
  }]
}
```

选择一个本账户未被其他限流绑定共用的 `namespace_id`。当前代码对 Cloudflare 提供的 `CF-Connecting-IP` 做 SHA-256 后作为 key，不把 IP 写入模型 metadata 或应用日志。这是匿名博客的粗粒度防滥用：同一出口的多人会共享额度，换出口可能绕过；计数按 Cloudflare location 最终一致，不能承诺全球精确的“每个人十次”。本配置不创建新 Gateway。

如果改用 WAF，规则只匹配主域的 `POST /api/chat` 与 `POST /api/chat/`，不要对所有博客路径限流；WAF 可用阈值和时间窗口随套餐而异，按控制台提供项设置即可，不必同时开启 Worker 和 WAF 两套相同规则。

官方依据：[Gateway 限流](https://developers.cloudflare.com/ai-gateway/features/rate-limiting/)、[Search 公共入口](https://developers.cloudflare.com/ai-search/configuration/retrieval/public-endpoint/)、[Worker 限流 binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)、[WAF 计数范围](https://developers.cloudflare.com/waf/rate-limiting-rules/request-rate/)、[Gateway 平台限制](https://developers.cloudflare.com/ai-gateway/reference/limits/)。支出上限是另外的金额控制，不等于请求频率限制。

同步 REST 请求遇到 HTTP 429 时最多尝试四次，优先遵守 `Retry-After`；没有该头时使用 2、4、8 秒的退避。服务器要求等待超过 60 秒时停止本轮，避免提前重试。单篇索引状态最多轮询约两分钟；仍未完成或返回错误时，本轮不记录成功、不继续删除文章。索引后台任务发生的限流可能表现为 Items 中的错误，需要待限额恢复后重新运行同步。聊天应把 429 转成“请求较多，请稍后再试”的可恢复提示，而不是连续重发。

## 公开内容如何导出

`ai-search:export` 读取本次构建的 `.generated/content.json`，只选 `page.kind === 'page'` 且 `type` 为 `docs`、`posts`、`weekly` 的页面。草稿、隐藏、跳转、`bookSearchExclude`、空正文以及分区和业务索引页均被排除。

正文复用已渲染的 `page.html`，通过 HTML 解析器转换为 Markdown：保留标题层次、正文、列表、表格、公开链接、代码和代码中的空行，去掉脚本、复制按钮、导航、隐藏 UI 和演示包装组件。ByAI 标签会在导出正文中写成明确的来源声明，避免因为模板中的声明不在 article 内而丢失。

不会上传整个 `BLOG_DIR`、Markdown 源文件或原始 `content.json`。`source`、完整 frontmatter、私有检出路径、渲染诊断均不进入导出清单。所有导出文件位于已忽略的 `.generated/`，不得提交到 Git，也不复制到 `dist/` 作为可下载的完整语料包。

生成文件的职责：

| 文件 | 内容和用途 |
| --- | --- |
| `.generated/ai-search/documents/<id>.md` | 单篇已公开正文和少量元数据，供同步上传 |
| `.generated/ai-search/references.json` | 当前部署可信的引用白名单：URL、显示标题、版本 hash 等；Worker 打包使用，不含正文 |
| `.generated/ai-search/manifest.json` | 引用清单、生产/预览标记、站点和内容提交、语料 hash |
| `.generated/ai-search-sync.json` | 本轮完整同步成功后的记录，失败不推进 |

`id` 为正式 canonical URL 的 SHA-256，远端 key 为 `tcitry-blog/articles/<id>.md`。正文更新时覆盖同一 key；URL 变化时新增新 key，旧 key进入删除清单。内容 hash 包含公开标题、日期、来源声明和正文，不包含检出路径或同步时间，因此相同的公开内容不会因为换发布目录而重复上传。

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

`deploy:verified` 已包含同步：发布前检查显式 token、远端实例配置与完整分页；发布后完成既有全站线上检查，核对 `/blog-release.json` 中的生产版本和 `/api/chat` 路由，再写部署回执并执行 `--apply`。环境中的 `BLOG_DIR` 必须指向已审查的独立内容检出，`BLOG_CONTENT_COMMIT` 固定对应提交。不要在生产发布目录重建，或从其他任务仍可能写入的共享 `dist/` 上传。

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

撤回文章在新 Worker 引用白名单中会立即消失；即使远端删除尚在排队，聊天也不能引用该文章。正文更新到索引生效之间可能暂时没有足够资料，界面应明确表示公开文章中未找到充分依据。

## 认证和 API

同步 CLI 只读取显式的 `CLOUDFLARE_API_TOKEN` 环境变量，不扫描浏览器、系统钥匙串、Wrangler 登录文件或其他项目的凭据。Token 按 Cloudflare 文档授予目标账户的 AI Search Edit 和 Run 权限，在运行同步的环境中设置，不写入仓库、不放进前端环境变量。API 响应中的任意错误正文不会原样打印，日志只包含状态码、错误代码和文章数量。[Items REST API 认证](https://developers.cloudflare.com/ai-search/api/items/rest-api/)

经明确授权的调用方也可通过 `syncAISearch({ client })` 注入客户端；`createAISearchClient({ authorize })` 接收返回请求头的回调，凭据提供方式由调用方负责，业务同步代码不读取本机认证存储。

当前实现使用 namespace 路径下的 Items API，上传使用 multipart 的 `file`、`metadata` 和 `wait_for_completion`；列举使用 `page`、`per_page=50`、`source=builtin`。上传成功并不总表示已可查询，因此脚本继续检查 Items 状态。[上传 API](https://developers.cloudflare.com/api/resources/ai_search/subresources/namespaces/subresources/instances/subresources/items/methods/upload/)、[分页 API](https://developers.cloudflare.com/api/resources/ai_search/subresources/namespaces/subresources/instances/subresources/items/methods/list/)

## 验证

`npm test` 包含 `tests/ai-search-*.test.mjs` 的合成测试：公开过滤、ByAI 标识、代码空行保留、URL/key/hash、发布语料封存、分页、删除范围、429 退避，以及索引失败不推进删除与完成状态。

上线验收还需在真实实例验证普通中文提问、技术名词、跨文章问题、找不到依据、来源卡片与原文链接，并验证停止生成和 429 提示。测试问题与样本只使用已公开文章。首次索引后查看 Items、Gateway 日志和检索返回质量，再决定是否开启共享 Gateway 限流及具体阈值。
