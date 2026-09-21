#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {consumeCompletionSseBuffer, mapChunkSources} from '../src/lib/ai-search-completion-sse.mjs';
import {searchRetrievalOptions} from '../src/lib/ai-search-retrieval-options.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDir = path.join(root, '.generated', 'ai-chat-eval');

async function loadEnv() {
  let text = '';
  try { text = await readFile(path.join(root, '.env.local'), 'utf8'); } catch {}
  try { text += '\n' + await readFile(path.join(root, '.env.production.local'), 'utf8'); } catch {}
  const env = {...parseEnv(text), ...process.env};
  const endpoint = env.AI_SEARCH_PUBLIC_URL;
  assert.ok(endpoint, 'Set AI_SEARCH_PUBLIC_URL in .env.local or .env.production.local');
  return endpoint.replace(/\/$/, '');
}

function normalizeEndpoint(input) {
  const url = new URL(input);
  if (url.pathname.endsWith('/search')) url.pathname = url.pathname.slice(0, -'/search'.length);
  url.search = '';
  url.hash = '';
  url.username = '';
  url.password = '';
  return url.toString().replace(/\/$/, '');
}

function publicChatUrl(base) {
  return `${base}/chat/completions`;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function percentile(values, p) {
  const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index]);
}

// Streams one chat turn and times three distinct moments:
//   headersMs — fetch() resolved (response headers only; NOT user-perceived latency)
//   ttfbMs    — first non-empty visible `choices[0].delta.content`
//   totalMs   — stream finished ([DONE] or body end)
export function createTurnTimer(now = () => performance.now()) {
  const started = now();
  const timing = {headersMs: null, ttfbMs: null, totalMs: null};
  return {
    timing,
    headers: () => { if (timing.headersMs === null) timing.headersMs = now() - started; },
    visibleText: delta => { if (timing.ttfbMs === null && typeof delta === 'string' && delta.trim()) timing.ttfbMs = now() - started; },
    finish: () => { timing.totalMs = now() - started; },
  };
}

async function chatCompletions(base, {messages}) {
  const request = {
    messages,
    stream: true,
    // Match production Convex assistant chat/search retrieval (no content_hash filters in eval).
    ai_search_options: searchRetrievalOptions(),
  };
  const timer = createTurnTimer();
  let attempt = 0;
  let response;
  let lastError;
  while (attempt < 3) {
    response = await fetch(publicChatUrl(base), {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(request),
    });
    if (response.status !== 429) break;
    attempt++;
    lastError = `HTTP 429 (attempt ${attempt})`;
    const retryAfter = response.headers.get('retry-after');
    const wait = retryAfter ? Number(retryAfter) * 1000 : 5000 * attempt;
    console.log(`  rate limited, waiting ${Math.round(wait)}ms before retry`);
    await response.body?.cancel?.().catch(() => {});
    await sleep(wait);
  }
  timer.headers();
  const report = {
    httpStatus: response.status,
    contentType: response.headers.get('content-type'),
    ...timer.timing,
    answer: '',
    sources: [],
    augmented: false,
    toolCalled: false,
    toolCallCount: 0,
    modelObserved: null,
    finishReason: null,
    error: lastError ?? null,
  };
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '');
    timer.finish();
    Object.assign(report, timer.timing);
    report.error = `HTTP ${response.status}: ${body.slice(0, 500)}`;
    return report;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolCallIds = new Set();
  const onFrame = frame => {
    if (frame.kind === 'chunks') report.sources = mapChunkSources(frame.chunks);
    if (frame.kind === 'done') timer.finish();
    if (frame.kind === 'message') {
      const data = frame.data;
      if (data.model && !report.modelObserved) report.modelObserved = data.model;
      const choice = data.choices?.[0];
      const delta = choice?.delta?.content ?? '';
      if (delta) { timer.visibleText(delta); report.answer += delta; }
      for (const call of choice?.delta?.tool_calls ?? []) toolCallIds.add(call.id ?? `${call.index ?? toolCallIds.size}`);
      if (choice?.finish_reason) report.finishReason = choice.finish_reason;
    }
  };
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer = consumeCompletionSseBuffer(buffer + decoder.decode(value, {stream: true}), onFrame);
    }
    buffer += decoder.decode();
    consumeCompletionSseBuffer(buffer, onFrame);
  } catch (error) {
    report.error = String(error?.message ?? error);
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (timer.timing.totalMs === null) timer.finish();
  Object.assign(report, timer.timing);
  report.augmented = report.sources.length > 0;
  report.toolCallCount = toolCallIds.size;
  report.toolCalled = report.toolCallCount > 0;
  if (!report.answer.trim()) report.error = 'Empty or missing answer text';
  return report;
}

async function evaluateCase(base, {turns, id, category, expectRetrieval}, {delayMs}) {
  const messages = [];
  const results = [];
  for (let i = 0; i < turns.length; i++) {
    messages.push({role: 'user', content: turns[i]});
    const result = await chatCompletions(base, {messages});
    results.push({turn: i + 1, question: turns[i], ...result});
    if (result.error) break;
    messages.push({role: 'assistant', content: result.answer});
    if (i < turns.length - 1) await sleep(delayMs);
  }
  const first = results[0];
  return {id, category, expectRetrieval: expectRetrieval ?? null, question: turns[0], turns: results,
    error: results.find(r => r.error)?.error ?? null,
    // Flattened first-turn fields keep older report consumers working.
    headersMs: first.headersMs, ttfbMs: first.ttfbMs, totalMs: first.totalMs, answer: first.answer, sources: first.sources,
    augmented: first.augmented, toolCalled: first.toolCalled, toolCallCount: first.toolCallCount,
    modelObserved: results.map(r => r.modelObserved).find(Boolean) ?? null, finishReason: first.finishReason};
}

export function summarize(results) {
  const turns = results.flatMap(r => r.turns.map(t => ({...t, category: r.category, expectRetrieval: r.expectRetrieval})));
  const ok = turns.filter(t => !t.error);
  const byCategory = {};
  for (const t of ok) {
    const bucket = byCategory[t.category] ??= {turns: 0, toolCalls: 0, augmented: 0, ttfb: [], total: [], headers: []};
    bucket.turns++;
    if (t.toolCalled) bucket.toolCalls++;
    if (t.augmented) bucket.augmented++;
    bucket.ttfb.push(t.ttfbMs);
    bucket.total.push(t.totalMs);
    bucket.headers.push(t.headersMs);
  }
  const stats = list => ({p50: percentile(list, 50), p90: percentile(list, 90)});
  const categories = Object.fromEntries(Object.entries(byCategory).map(([name, b]) => [name, {
    turns: b.turns, toolCallRate: b.turns ? b.toolCalls / b.turns : null, augmentedRate: b.turns ? b.augmented / b.turns : null,
    ttfbMs: stats(b.ttfb), totalMs: stats(b.total), headersMs: stats(b.headers),
  }]));
  const unexpectedRetrieval = ok.filter(t => t.expectRetrieval === false && (t.toolCalled || t.augmented)).length;
  const missingRetrieval = ok.filter(t => t.expectRetrieval === true && !(t.toolCalled || t.augmented)).length;
  return {
    cases: results.length, turns: turns.length, okTurns: ok.length, errorTurns: turns.length - ok.length,
    ttfbMs: stats(ok.map(t => t.ttfbMs)), totalMs: stats(ok.map(t => t.totalMs)), headersMs: stats(ok.map(t => t.headersMs)),
    toolCallRate: ok.length ? ok.filter(t => t.toolCalled).length / ok.length : null,
    augmentedRate: ok.length ? ok.filter(t => t.augmented).length / ok.length : null,
    unexpectedRetrieval, missingRetrieval, categories,
  };
}

function pct(value) {
  return value === null || value === undefined ? 'n/a' : `${Math.round(value * 100)}%`;
}

function formatReport(results) {
  const summary = summarize(results);
  const observed = new Set(results.map(r => r.modelObserved).filter(Boolean));
  const lines = ['# AI Chat Evaluation Report\n'];
  lines.push(`- cases: ${summary.cases}, turns: ${summary.turns}, ok: ${summary.okTurns}, errors: ${summary.errorTurns}`);
  lines.push(`- observed model(s): ${[...observed].join(', ') || 'unknown'}`);
  lines.push(`- TTFB (first visible text) p50/p90: ${summary.ttfbMs.p50 ?? 'n/a'}ms / ${summary.ttfbMs.p90 ?? 'n/a'}ms`);
  lines.push(`- total p50/p90: ${summary.totalMs.p50 ?? 'n/a'}ms / ${summary.totalMs.p90 ?? 'n/a'}ms (headers p50: ${summary.headersMs.p50 ?? 'n/a'}ms)`);
  lines.push(`- tool-call rate: ${pct(summary.toolCallRate)}, augmented rate: ${pct(summary.augmentedRate)}`);
  lines.push(`- unexpected retrieval (expectRetrieval=false): ${summary.unexpectedRetrieval}, missing retrieval (expectRetrieval=true): ${summary.missingRetrieval}`);
  lines.push('\n| category | turns | tool-call | augmented | TTFB p50 | TTFB p90 | total p50 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, c] of Object.entries(summary.categories)) {
    lines.push(`| ${name} | ${c.turns} | ${pct(c.toolCallRate)} | ${pct(c.augmentedRate)} | ${c.ttfbMs.p50 ?? 'n/a'}ms | ${c.ttfbMs.p90 ?? 'n/a'}ms | ${c.totalMs.p50 ?? 'n/a'}ms |`);
  }
  for (const r of results) {
    lines.push(`\n### ${r.id} [${r.category}]${r.expectRetrieval === false ? ' (no-retrieval expected)' : ''}`);
    for (const t of r.turns) {
      lines.push(`\n#### turn ${t.turn}`);
      lines.push(`question: ${t.question}`);
      if (t.error) lines.push(`error: ${t.error}`);
      else {
        lines.push(`observed model: ${t.modelObserved}; finish: ${t.finishReason}`);
        lines.push(`timing: headers ${Math.round(t.headersMs)}ms, ttfb ${Math.round(t.ttfbMs)}ms, total ${Math.round(t.totalMs)}ms`);
        lines.push(`tool calls: ${t.toolCallCount}; sources: ${t.sources.length} (top score: ${t.sources[0]?.score ?? 'n/a'})`);
        lines.push(`answer:\n${t.answer}`);
      }
    }
  }
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const baseline = args.includes('--baseline');
  const delayMs = Number(args.find((_, i) => i > 0 && args[i - 1] === '--delay')) || 2000;
  const sample = Number(args.find((_, i) => i > 0 && args[i - 1] === '--sample')) || Number.POSITIVE_INFINITY;
  const category = args.find((_, i) => i > 0 && args[i - 1] === '--category');
  assert.ok(Number.isInteger(delayMs) && delayMs >= 0, 'delay must be a non-negative integer');
  assert.ok(sample === Number.POSITIVE_INFINITY || (Number.isInteger(sample) && sample > 0), 'sample must be a positive integer');

  const endpoint = normalizeEndpoint(await loadEnv());
  const fixture = JSON.parse(await readFile(path.join(root, 'tests', 'fixtures', 'ai-chat-eval.json'), 'utf8'));
  const pool = category ? fixture.questions.filter(q => q.category === category) : fixture.questions;
  const selected = pool.slice(0, Math.min(sample, pool.length));

  const results = [];
  for (let i = 0; i < selected.length; i++) {
    const q = selected[i];
    const result = await evaluateCase(endpoint, q, {delayMs});
    results.push(result);
    const last = result.turns.at(-1);
    console.log(`${q.id}: ${result.error ? 'ERROR ' + result.error : `OK ttfb=${Math.round(last.ttfbMs)}ms total=${Math.round(last.totalMs)}ms tools=${last.toolCallCount} sources=${last.sources.length} ` + last.answer.slice(0, 40).replace(/\n/g, ' ')}`);
    if (i < selected.length - 1) await sleep(delayMs);
  }

  await mkdir(outputDir, {recursive: true});
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const observed = [...new Set(results.map(r => r.modelObserved).filter(Boolean))].map(m => m.replace(/[^a-zA-Z0-9_-]/g, '_')).join('-') || 'unknown';
  const name = baseline ? `baseline-${timestamp}-${observed}` : `eval-${timestamp}-${observed}`;
  const jsonPath = path.join(outputDir, `${name}.json`);
  const mdPath = path.join(outputDir, `${name}.md`);
  const retrievalConfig = searchRetrievalOptions();
  await writeFile(jsonPath, JSON.stringify({endpoint, observed, retrievalConfig, generatedAt: new Date().toISOString(), summary: summarize(results), results}, null, 2) + '\n');
  await writeFile(mdPath, formatReport(results));
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => {
    console.error(error instanceof assert.AssertionError ? error.message : error);
    process.exitCode = 1;
  });
}
