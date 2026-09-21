# 实现指引（定版）

> **本条取代本 issue 前三条 Claude 评论。** 前三条保留作为推导过程，如有冲突**一律以本条为准**。实现方只读本条即可，不需要回溯。
>
> 特别注意两处已被推翻的旧说法：~~「三个 allowlist 模型对比」~~、~~「Worker 方案被 AGENTS.md 规则排除」~~。正确表述见下文。

基准提交：`main` / `1a65090`。

---

## 1. 已确认的决策

| 项 | 结论 |
| --- | --- |
| tool loop 跑在哪 | **Convex Agent**（`agent.streamText` + `tools` + `stopWhen`），不迁出 |
| 生成模型 | **Workers AI OpenAI-compatible 端点**，走现有 Gateway `tcitry-blog-chat` |
| 当前 model id | **`@cf/zai-org/glm-5.3`**（Dashboard 实测确认，**无 `-flash` 后缀**） |
| 凭据 | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` 已配置在 Convex 环境变量 |
| AI Search | 降级为纯 search backend，**只保留 `/search`**；`/chat/completions` 退出生产路径 |
| Worker 代理 | **评估后不选**（不是被规则排除）：省不了代码、TTFB 多一跳。因此 `AGENTS.md:21` 维持原样，`/api/chat` 保持 404 |

---

## 2. 现状复核（实现前必须理解的四个事实）

**(1) 一次回答最多触发 3 次向量检索。**
`convex/assistant.ts` `generate`：`retrievePublicSources(retrievalQuery)` → 空结果则再搜一次 → 再进 `publicChatModel`，而 `transformRequestBody` 又带了 `ai_search_options: chatRetrievalOptions(hashes)`，**AI Search 在生成前按 content_hash filter 再检索一遍**。寒暄题也至少吃 1–2 次。这是 TTFB 的主要来源，**不是 prompt 问题，也不是 threshold 问题**。

**(2) `safeModelMiddleware` 是结构性禁 tools，不是配置项。** 三处会让 tool call 直接失败：
- `transform` 只 enqueue `text-*` / `finish` / `stream-start` / `response-metadata`，其余 part **静默丢弃** → `tool-call` 凭空消失；
- `finish` 分支 `if (part.finishReason.unified === 'length' || !tokenCount) throw` → **纯 tool-call step 的 `tokenCount` 恰好是 0**，必抛 SAFE_ERROR；
- `finishReason === 'tool-calls'` 同样撞上面这条。

**(3) `verifiedCompletionStream` 的 `chunks` 校验，存在的唯一理由是「生成端会自己再检索」。** 检索改成我们自己调用的 tool 后，进入 prompt 的文本 100% 由我们构造，这层校验的输入面消失，校验点收敛到 `validatePublicChunk` 一处。这是简化，不是安全退化——但必须用测试钉死（见 §7）。

**(4) 现有 eval 的 TTFB 数字不可用作基线。** `scripts/eval-ai-chat.mjs:58` 的 `firstByteMs` 在 `fetch` resolve 处取值，量的是**响应头**到达时间，不是用户感知首字（第一个非空 `choices[0].delta.content`）。且只跑 `turns[0]`，多轮 fixture 完全没被使用。

**(5) 实例 System prompt = Default，与 `instructions()` 叠加生效。** 两份提示词同时作用于生成，Cloudflare 默认提示会稀释我们的约束。这是 DEV-78 之后「线上回答仍差」的一个此前未排查的成因，与检索架构无关。方案落地后提示词只剩我们一份——**因此不能把当前质量体感当作 glm-5.3 的能力上限**。

---

## 3. 目标架构

```
用户消息 → Convex generate()
  ├─ 取 completedContext（最近 4 轮已完成 Q/A，现成逻辑保留）
  ├─ phase='thinking'，直接进模型（零检索）
  │
  ├─ 模型判定不需要站内资料 → 直接流式出字（0 次检索）  ← 快路径
  │     phase='writing'
  │
  └─ 模型发 search_blog({query}) → phase='searching'
        ├─ 参数校验：query ≤ 200 字符、trim 非空、无控制字符
        ├─ retrievePublicSources(query)  ← 完全复用，含 validatePublicChunk
        ├─ setSources(合并去重, cap 5)   ← UI「参考文章」只认这里
        └─ 返回模型：编号 + title + sourceKind + updatedAt + text（**不含 URL**）
              → 带 snippet 续写，phase='writing'（必要时最多再 call 一次）
```

---

## 4. 按文件的改动清单

**`convex/assistant.ts`**
- 删除 `generate` 里的强制预检索、空结果 fallback、`retrievalQuery` 服务端拼接；改为建 tool 后直接 `streamText`。
- ⚠️ **`completedContext` 必须一起改**：`answers.length !== 1` 的判断会被多 step 的 assistant 消息打破，追问历史会取不到。改为「取该 order 下最后一条 success 的 assistant 文本消息」。**这是最容易漏的回归点。**
- `finish` 的 `noSources` 收窄：仅当 `toolCalled && sources.length === 0 && 模型零文本产出` 时才插入 `NO_SOURCES`。
- `setSources` 支持跨 tool 调用合并去重，编号一旦分配不再变动。

**`convex/assistantModel.ts`**
- `safeModelMiddleware`：放行 `tool-input-start` / `tool-input-delta` / `tool-input-end` / `tool-call`（**逐个显式 enqueue，保持白名单性格，不要改成黑名单**）；仍丢弃 `reasoning*` / `raw` / `source` / `file`；收到 `tool-result` 即 throw（tool result 由我们本地产生，不该从 provider 流里来）。
- `finish` 分支：`finishReason === 'tool-calls'` 时允许 `tokenCount === 0`；`length` 仍 throw；`stop` 且全程零文本仍 throw。
- `tool-call` 配额校验：累计 > 2 → throw；单次 `input` JSON > 2 KB → throw。
- 新增 `first_text_delta` 观测点（首个非空可见 delta，带 `ttfbMs`）——**这是之后所有 TTFB 数字的唯一口径**。
- `publicChatModel` 换成 Workers AI provider，model id 读新 env `ASSISTANT_CHAT_MODEL`。
- `instructions()` 里「我由 Cloudflare AI Search 实例驱动，具体生成模型由该实例配置决定」**会变成假话**，必须改写。
- 退役：`contextualMessages`、`chatRetrievalOptions` 调用、`verifiedCompletionStream` 的 chunks 分支（S5 清理）。

**`convex/assistantPublicSearch.ts`** — 不动，整个复用。

**`convex/schema.ts`** — `assistantRuns` 增加 `phase`（`'thinking' | 'searching' | 'writing'`）、`toolCalls`(number)、`mode`。`getRunStates` 带出 `phase`。

**`src/components/chat/AgentChat.tsx`** — `Turn` 的 loader 文案改读 `phase`，不再靠 `run.sources.length` 猜：`thinking` →「正在思考」（**替代现在一上来就显示的「正在检索文章」**）、`searching` →「正在检索文章」、`writing` →「正在整理回答」。`components.a` 的 href 白名单逻辑**保留不动**。

**`scripts/eval-ai-chat.mjs`** — TTFB 口径修正到首个非空 `delta.content`（响应头时间保留为 `headersMs`，两个都报）；跑完 `turns[]` 全部轮次；每 case 记录 `toolCalled` / `toolCallCount` / `augmented` / `sources[]` / `ttfbMs` / `totalMs` / `finishReason`；报告新增**分类别 tool 调用率**与 **TTFB p50/p90**。

**`tests/fixtures/ai-chat-eval.json`** — 修 q01 过期的模型断言（`:14` 仍写 llama-3.3-70b）；新增 `no-retrieval` 类别（寒暄、元问题、纯通用技术题）——**当前 fixture 完全没有这一类，而它正是要测的快路径**。

**`scripts/set-ai-search-model.mjs`** — ALLOWLIST（`:11-13`）不含当前实际在用的 `@cf/zai-org/glm-5.3`，脚本设不了当前模型。先修 ALLOWLIST；S5 时该脚本对 chat 路径失效，删除或改用途。

**`docs/ai-search.md`** — 改写两处：「Convex 不直接配置 Gateway hostname、Cloudflare Account token 或固定模型」、「回答模型与 Gateway 由 AI Search 实例配置决定」。

---

## 5. 安全边界与封顶

**校验链**（与现状等价，收敛到一处）：tool handler → `validatePublicChunk`（`key` 命中本地 `references.json`，且 `content_hash` / `canonical_url` / `source_kind` 三项全等）→ `setSources`（非 running 拒绝、> 5 抛错）→ UI 只渲染 `run.sources`。

**tool result 不含 URL**：格式 `[1] (ai-assisted) 标题 (updated 2026-03-01)\n正文…`。模型没有 URL 就编不出 URL。

**封顶全部写进代码常量，不靠 prompt 自觉：**

| 维度 | 上限 |
| --- | --- |
| tool call 次数 | 2（`stopWhen: stepCountIs(3)`，middleware 再独立计数） |
| 单次 query | ≤ 200 字符，越界返回**结构化错误 result，不 throw** |
| snippet 总预算 | 14 000 字符 / run（**跨多次 tool 共享**，沿用现有 `remaining` 计数器语义） |
| sources | ≤ 5 / run（跨调用去重合并） |
| 单次 tool 墙钟 | 6 s |
| tool 累计墙钟 | 12 s |
| run 总时长 | 120 s（`deadlineAt` 不变） |

**tool 失败（429 / 超时 / 5xx）不杀 run**：返回 `{ok: false, reason: 'unavailable'}`，提示词要求此时按「博客中暂未找到足够依据」口径回答且不得编造。只有 `setSources` 返回 false（run 已非 running）才终止。

**`SAFE_ERROR` 语义不变**：传输/协议/越界/校验失败一律 SAFE_ERROR，不向用户暴露上游细节；现有 `publicErrorFields` 的脱敏策略照搬到新 provider。

---

## 6. 追问与空结果

**模型自己写检索词**，提示词要求「检索词必须自包含，不得出现『那篇』『上面那个』这类指代」。

**服务端只留一个确定性兜底**：query 命中指代词正则（`那篇|上面那个|这个|刚才(说的)?|它` 且长度 < 12）时，用现有 `extractTopicTerms(context.messages)` 拼一次再检索，并打 `tool_query_augmented` 观测点。

**不保留** `generate` 里那段「针对主题「…」的追问。上文：…」的服务端拼接——那正是「query 不是模型自己写的」的根因。兜底命中率进 eval 报告，长期 > 15% 说明提示词或模型该调，**而不是加大兜底**。

---

## 7. 可观测

`GenerationEvent` 新增：`route_mode`、`tool_skipped`、`tool_call`、`tool_complete`（`queryLength` / `chunkCount` / `sourceCount` / `elapsedMs`）、`tool_error`、`tool_query_augmented`、`first_text_delta`（`ttfbMs`）。

**继续不记录 query 原文**，只记长度与 `queryKind`，与现有脱敏纪律一致。

## 测试

`convex/assistant.test.ts` / `assistantModel.test.ts` 必须新增：
- middleware：tool part 正常透传；`finishReason='tool-calls'` 且 `tokenCount=0` **不再抛 SAFE_ERROR**；收到 `tool-result` part 立即 throw；超过 2 次 tool call throw。
- tool handler：伪造 `content_hash` / 篡改 `canonical_url` / 未知 key 的 chunk **不进 sources、不进 prompt**（**这是替代 `chunks` 事件校验的那条测试，不可省**）。
- 多 step 下 `completedContext` 仍能正确取回上一轮 Q/A。
- `@convex-dev/agent@0.7.2` 的 tool 持久化行为（tool message 的 order/stepOrder 分配）先用 `convex-test` 钉一遍，再写业务。

---

## 8. 切片与执行纪律

**S0（gate，必须先完成并回帖）**
① 修 fixture q01 过期断言 + `set-ai-search-model.mjs` ALLOWLIST；
② 按 §4 改造 eval（TTFB 口径、多轮、分类别统计），跑出**现状基线**；
③ 探针：验证 `@cf/zai-org/glm-5.3` 在 Workers AI OpenAI-compatible 端点上的 function calling（能否稳定发 tool call、no-retrieval 题是否误调、喂回 tool result 能否正常续写）。

> **S0 结论回帖前不得进入 S1。** 整个方案建立在「glm-5.3 的 function calling 可用」这个**尚未验证**的前提上。若探针显示不可用，回退 A′ 控制块协议（模型首行输出 `<search>检索词</search>`，复用 `visibleTextFilter` 已有的跨 chunk 隐藏标签能力拦截），**届时重新讨论，不要自行开工**。

**S1** provider 抽象 + middleware 放行 tool（flag 默认 off，**行为不变**）
**S2** `search_blog` tool + loop + 新 instructions + `setSources` 合并封顶（flag 后面，旧路径完好）
**S3** `phase` 字段 + UI 文案（可与 S2 并行）
**S4** eval / 单测对齐
**S5** 灰度与清理

**灰度**：Convex env `ASSISTANT_TOOL_MODE = off | allowlist | on`（`allowlist` 配 `ASSISTANT_TOOL_OWNERS`，先只对站长开）。`generate` 入口读一次，写进 `assistantRuns.mode` 和每条日志。
**回滚 = 改一个 env 值，不需要重新部署。** 旧 pipeline 代码保留到 burn-in 结束（≥ 2 周或 ≥ 200 次真实 run）再删。

### 不要做的事

- ❌ 跳过 S0 直接实现 tool loop
- ❌ 只调 `match_threshold` / 开 `query_rewrite` 而不改编排（已被明确否决）
- ❌ 引入 Worker 聊天或检索桥（`AGENTS.md:21` 仍然有效）
- ❌ 把 `validatePublicChunk` 移出 Convex 或弱化为「信任上游」
- ❌ 一次性大改：每个切片独立 PR，flag 默认 off

---

## 9. 验收

| 指标 | 目标 |
| --- | --- |
| 无检索必要问题 TTFB | p50 ≤ **1.2 s**、p90 ≤ **2.0 s**，且较基线**下降 ≥ 50%** |
| 需检索问题 TTFB | 不劣于基线 **+15%** |
| tool 调用率 | `no-retrieval` 类别 ≤ **10%**；`retrieval` 类别 ≥ **90%** |
| 元问题 / 寒暄 | 不出现「参考文章」，loader 不出现「正在检索文章」 |
| 安全回归 | 伪造 / 未知 hash 的 chunk 不进 UI、不进回答引用（单测覆盖） |
| 追问兜底命中率 | ≤ 15% |

> ⚠️ **上表数字在 S0 基线产出前只是目标值，不是承诺。** 基线跑出来后按实际数据回本 issue 修订。

---
_Generated by [Claude Code](https://claude.ai/code)_