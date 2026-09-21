#!/usr/bin/env node
// S0 probe (DEV-298): does the configured Workers AI model emit OpenAI-style
// function calls reliably through the /ai/v1 chat completions endpoint?
//
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node scripts/probe-chat-tools.mjs [--repeat 3] [--reasoning default|none|low|template|both|all] [--delay 4000]
//
// Requests bypass the gateway cache (cf-aig-skip-cache) so timings are real. The
// gateway rate limit is tight; keep --delay generous and expect 429 retries.
//
// Never prints the token. Writes .generated/ai-chat-eval/probe-<ts>.json.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {createTurnTimer, percentile} from './eval-ai-chat.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDir = path.join(root, '.generated', 'ai-chat-eval');

const TOOL = {
  type: 'function',
  function: {
    name: 'search_blog',
    description: '在本站（yindongliang.com）已发布的文章和文档中检索。只有当用户的问题涉及本站文章内容、站点配置、作者写过的具体技术细节时才调用；闲聊、关于你自己的问题、通用编程或常识问题不要调用。',
    parameters: {type: 'object', properties: {query: {type: 'string', description: '检索词，不超过 200 字符'}}, required: ['query']},
  },
};

// How to suppress GLM thinking. `none` is NOT honored by Workers AI (measured 2026-09-21); `low` and `template` both yield 0 reasoning tokens.
const REASONING_MODES = {
  default: {},
  none: {reasoning_effort: 'none'},
  low: {reasoning_effort: 'low'},
  template: {chat_template_kwargs: {enable_thinking: false}},
};

const SYSTEM = '你是 tcitry-blog 的中文博客助手。需要引用本站文章事实时先调用 search_blog；否则直接回答。回答简洁。';

const CASES = [
  {id: 'retrieval-1', expectTool: true, prompt: 'AI Search 的 embedding 模型是什么？',
    result: {title: 'Cloudflare AI Search 配置', text: 'AI Search 的 embedding 模型是 @cf/qwen/qwen3-embedding-0.6b，检索使用 hybrid 模式并开启 bge-reranker-base 重排。'}},
  {id: 'retrieval-2', expectTool: true, prompt: '博客评论现在使用什么认证？',
    result: {title: '评论系统迁移到 Convex', text: '博客评论使用 Clerk 登录，Convex 后端校验身份后写入评论；不再使用 Giscus，也不支持匿名评论。'}},
  {id: 'retrieval-3', expectTool: true, prompt: '本站从 Hugo 迁移到 Astro 后保留了哪些兼容性？',
    result: {title: '从 Hugo 迁移到 Astro', text: '迁移后保留了历史 URL 和 canonical pathname，评论按 canonical pathname 关联以保持兼容；Hugo 构建配置和 GitHub Pages 工作流已删除。'}},
  {id: 'chitchat-1', expectTool: false, prompt: '你好！'},
  {id: 'meta-1', expectTool: false, prompt: '你是谁？你能帮我做什么？'},
  {id: 'general-1', expectTool: false, prompt: '用一句话解释 TCP 三次握手。'},
  {id: 'general-2', expectTool: false, prompt: 'Python 里 list 和 tuple 有什么区别？'},
];

function fakeResult(testCase) {
  return JSON.stringify({results: [{n: 1, sourceKind: 'author', updatedAt: '2026-08-01', ...testCase.result}]});
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadEnv() {
  let text = '';
  try { text = await readFile(path.join(root, '.env.local'), 'utf8'); } catch {}
  const env = {...parseEnv(text), ...process.env};
  assert.ok(env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID required');
  assert.ok(env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN required');
  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN,
    model: env.ASSISTANT_CHAT_MODEL || '@cf/zai-org/glm-5.3',
    gateway: env.ASSISTANT_CHAT_GATEWAY || 'tcitry-blog-chat',
  };
}

function parseSse(text, onData) {
  for (const frame of text.split(/\r?\n\r?\n/)) {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('');
    if (!data || data === '[DONE]') continue;
    try { onData(JSON.parse(data)); } catch {}
  }
}

async function stream(cfg, body) {
  let response;
  let retries = 0;
  let timer;
  while (true) {
    timer = createTurnTimer();
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/ai/v1/chat/completions`, {
      method: 'POST',
      headers: {authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json', 'cf-aig-gateway-id': cfg.gateway, 'cf-aig-skip-cache': 'true'},
      body: JSON.stringify({...body, model: cfg.model, stream: true}),
    });
    if (response.status !== 429 || retries >= 4) break;
    retries++;
    const retryAfter = Number(response.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * retries;
    console.log(`  429, waiting ${wait}ms (retry ${retries})`);
    await response.body?.cancel?.().catch(() => {});
    await sleep(wait);
  }
  timer.headers();
  const out = {status: response.status, retries, text: '', reasoningChars: 0, toolCalls: new Map(), finishReason: null, error: null, raw: ''};
  if (!response.ok) {
    out.error = `HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`;
    timer.finish();
    return {...out, toolCalls: [], ...timer.timing};
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const onData = data => {
    const choice = data.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string' && delta.content) { timer.visibleText(delta.content); out.text += delta.content; }
    if (typeof delta.reasoning_content === 'string') out.reasoningChars += delta.reasoning_content.length;
    if (typeof delta.reasoning === 'string') out.reasoningChars += delta.reasoning.length;
    for (const call of delta.tool_calls ?? []) {
      const key = call.index ?? call.id ?? 0;
      const entry = out.toolCalls.get(key) ?? {id: call.id, name: '', arguments: ''};
      if (call.id) entry.id = call.id;
      if (call.function?.name) entry.name += call.function.name;
      if (call.function?.arguments) entry.arguments += call.function.arguments;
      out.toolCalls.set(key, entry);
    }
    if (choice.finish_reason) out.finishReason = choice.finish_reason;
  };
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    const cut = buffer.lastIndexOf('\n\n');
    if (cut >= 0) { parseSse(buffer.slice(0, cut), onData); buffer = buffer.slice(cut + 2); }
  }
  buffer += decoder.decode();
  parseSse(buffer, onData);
  timer.finish();
  return {...out, toolCalls: [...out.toolCalls.values()], ...timer.timing};
}

async function runCase(cfg, testCase, reasoning) {
  const extra = REASONING_MODES[reasoning];
  assert.ok(extra, `unknown reasoning mode ${reasoning}`);
  const messages = [{role: 'system', content: SYSTEM}, {role: 'user', content: testCase.prompt}];
  const first = await stream(cfg, {messages, tools: [TOOL], tool_choice: 'auto', max_tokens: 512, temperature: 0.3, ...extra});
  const result = {id: testCase.id, expectTool: testCase.expectTool, reasoning, first: {
    status: first.status, retries: first.retries, error: first.error, finishReason: first.finishReason, headersMs: first.headersMs, ttfbMs: first.ttfbMs, totalMs: first.totalMs,
    textChars: first.text.length, reasoningChars: first.reasoningChars, toolCalls: first.toolCalls,
  }, followUp: null};
  result.toolCalled = first.toolCalls.length > 0;
  result.pass = !first.error && result.toolCalled === testCase.expectTool && (testCase.expectTool || first.text.trim().length > 0);
  if (result.toolCalled) {
    let args = null;
    try { args = JSON.parse(first.toolCalls[0].arguments); } catch {}
    result.first.argsValid = Boolean(args && typeof args.query === 'string' && args.query.trim() && args.query.length <= 200);
    result.pass = result.pass && result.first.argsValid && first.toolCalls[0].name === 'search_blog';
    const call = first.toolCalls[0];
    const second = await stream(cfg, {messages: [...messages,
      {role: 'assistant', content: first.text || null, tool_calls: [{id: call.id ?? 'call_0', type: 'function', function: {name: call.name, arguments: call.arguments}}]},
      {role: 'tool', tool_call_id: call.id ?? 'call_0', content: fakeResult(testCase)},
    ], tools: [TOOL], tool_choice: 'auto', max_tokens: 512, temperature: 0.3, ...extra});
    result.followUp = {status: second.status, error: second.error, finishReason: second.finishReason, ttfbMs: second.ttfbMs, totalMs: second.totalMs,
      textChars: second.text.length, reasoningChars: second.reasoningChars, extraToolCalls: second.toolCalls.length, preview: second.text.slice(0, 120)};
    // A second search_blog call is allowed (production caps at 2); a third is not.
    result.pass = result.pass && !second.error && ((second.text.trim().length > 0 && second.finishReason === 'stop') || second.toolCalls.length === 1);
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const repeat = Number(args.find((_, i) => i > 0 && args[i - 1] === '--repeat')) || 3;
  const reasoningArg = args.find((_, i) => i > 0 && args[i - 1] === '--reasoning') || 'both';
  const delayMs = Number(args.find((_, i) => i > 0 && args[i - 1] === '--delay')) || 3000;
  const modes = reasoningArg === 'both' ? ['default', 'low'] : reasoningArg === 'all' ? Object.keys(REASONING_MODES) : reasoningArg.split(',');
  const cfg = await loadEnv();
  const results = [];
  for (const reasoning of modes) {
    for (const testCase of CASES) {
      for (let i = 0; i < repeat; i++) {
        const result = await runCase(cfg, testCase, reasoning);
        results.push(result);
        await sleep(delayMs);
        console.log(`[${reasoning}] ${testCase.id} #${i + 1}: ${result.pass ? 'PASS' : 'FAIL'} tool=${result.toolCalled} finish=${result.first.finishReason} ttfb=${Math.round(result.first.ttfbMs ?? -1)}ms total=${Math.round(result.first.totalMs)}ms reasoningChars=${result.first.reasoningChars}${result.first.error ? ' ' + result.first.error : ''}`);
      }
    }
  }
  const summary = {};
  for (const reasoning of modes) {
    const rows = results.filter(r => r.reasoning === reasoning);
    const ret = rows.filter(r => r.expectTool);
    const non = rows.filter(r => !r.expectTool);
    summary[reasoning] = {
      runs: rows.length, pass: rows.filter(r => r.pass).length,
      retrievalToolRate: ret.length ? ret.filter(r => r.toolCalled).length / ret.length : null,
      noRetrievalFalsePositiveRate: non.length ? non.filter(r => r.toolCalled).length / non.length : null,
      followUpOk: ret.filter(r => r.followUp && !r.followUp.error && r.followUp.finishReason === 'stop').length,
      followUpReSearched: ret.filter(r => r.followUp && r.followUp.extraToolCalls > 0).length,
      reasoningCharsP50: percentile(rows.map(r => r.first.reasoningChars), 50),
      rateLimited: rows.filter(r => r.first.retries > 0 || r.first.error?.includes('429')).length,
      noRetrievalTtfbMs: {p50: percentile(non.map(r => r.first.ttfbMs), 50), p90: percentile(non.map(r => r.first.ttfbMs), 90)},
      toolCallLatencyMs: {p50: percentile(ret.filter(r => r.toolCalled).map(r => r.first.totalMs), 50)},
      followUpTtfbMs: {p50: percentile(ret.map(r => r.followUp?.ttfbMs ?? NaN), 50)},
      errors: rows.filter(r => r.first.error || r.followUp?.error).length,
    };
  }
  console.log('\nsummary:', JSON.stringify(summary, null, 2));
  await mkdir(outputDir, {recursive: true});
  const file = path.join(outputDir, `probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify({model: cfg.model, gateway: cfg.gateway, generatedAt: new Date().toISOString(), summary, results}, null, 2) + '\n');
  console.log(`Wrote ${file}`);
  const verdict = Object.values(summary).some(s => s.retrievalToolRate >= 0.8 && s.noRetrievalFalsePositiveRate <= 0.2 && s.followUpOk > 0);
  console.log(`\nverdict: function calling ${verdict ? 'VIABLE' : 'NOT VIABLE'} for tool loop`);
  process.exitCode = verdict ? 0 : 2;
}

main().catch(error => {
  console.error(error instanceof assert.AssertionError ? error.message : error);
  process.exitCode = 1;
});
