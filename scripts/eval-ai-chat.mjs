#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDir = path.join(root, '.generated', 'ai-chat-eval');

async function loadEnv() {
  let text = '';
  try { text = await readFile(path.join(root, '.env.local'), 'utf8'); } catch {}
  try { text += '\n' + await readFile(path.join(root, '.env.production.local'), 'utf8'); } catch {}
  const env = parseEnv(text);
  const endpoint = env.PUBLIC_AI_SEARCH_URL;
  assert.ok(endpoint, 'Set PUBLIC_AI_SEARCH_URL in .env.local or .env.production.local');
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

async function chatCompletions(base, {question}) {
  const request = {
    messages: [{role: 'user', content: question}],
    stream: true,
    ai_search_options: {
      retrieval: {
        retrieval_type: 'vector',
        max_num_results: 8,
        match_threshold: 0.45,
        return_on_failure: false,
      },
      query_rewrite: {enabled: false},
      reranking: {enabled: false},
      cache: {enabled: false},
    },
  };
  const started = performance.now();
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
  const firstByteMs = performance.now() - started;
  const report = {
    httpStatus: response.status,
    contentType: response.headers.get('content-type'),
    firstByteMs,
    totalMs: firstByteMs,
    answer: '',
    sources: [],
    modelObserved: null,
    finishReason: null,
    error: lastError ?? null,
  };
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '');
    report.error = `HTTP ${response.status}: ${body.slice(0, 500)}`;
    return report;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      text += decoder.decode(value, {stream: true});
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') {
          report.totalMs = performance.now() - started;
          continue;
        }
        try {
          const data = JSON.parse(payload);
          if (data.event === 'chunks') {
            report.sources = (data.chunks || []).map(chunk => ({
              key: chunk?.item?.key,
              score: chunk?.score,
              title: chunk?.item?.metadata?.canonical_url,
              hash: chunk?.item?.metadata?.content_hash,
            }));
            continue;
          }
          if (data.model && !report.modelObserved) report.modelObserved = data.model;
          const delta = data.choices?.[0]?.delta?.content ?? '';
          if (delta) report.answer += delta;
          if (data.choices?.[0]?.finish_reason) report.finishReason = data.choices[0].finish_reason;
        } catch {
          // ignore malformed non-DATA lines
        }
      }
      text = text.slice(text.lastIndexOf('\n') + 1);
    }
  } catch (error) {
    report.error = String(error?.message ?? error);
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!report.answer.trim()) report.error = 'Empty or missing answer text';
  return report;
}

async function evaluateModel(base, {turns, id, category}) {
  const question = turns[0];
  const result = await chatCompletions(base, {question});
  return {id, category, question, ...result};
}

function formatReport(results) {
  const rows = results;
  const errors = rows.filter(r => r.error);
  const ok = rows.filter(r => !r.error);
  const avgTotal = ok.length ? Math.round(ok.reduce((s, r) => s + r.totalMs, 0) / ok.length) : 0;
  const avgFirst = ok.length ? Math.round(ok.reduce((s, r) => s + r.firstByteMs, 0) / ok.length) : 0;
  const observed = new Set(rows.map(r => r.modelObserved).filter(Boolean));
  const lines = ['# AI Chat Evaluation Report\n'];
  lines.push(`- total: ${rows.length}, ok: ${ok.length}, errors: ${errors.length}`);
  lines.push(`- observed model(s): ${[...observed].join(', ') || 'unknown'}`);
  lines.push(`- avg first byte: ${avgFirst}ms, avg total: ${avgTotal}ms`);
  for (const r of rows) {
    lines.push(`\n### Q${r.id} [${r.category}]`);
    lines.push(`question: ${r.question}`);
    if (r.error) lines.push(`error: ${r.error}`);
    else {
      lines.push(`observed model: ${r.modelObserved}`);
      lines.push(`sources: ${r.sources.length} (top score: ${r.sources[0]?.score ?? 'n/a'})`);
      lines.push(`answer:\n${r.answer}`);
    }
  }
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const baseline = args.includes('--baseline');
  const delayMs = Number(args.find((_, i) => i > 0 && args[i - 1] === '--delay')) || 2000;
  const sample = Number(args.find((_, i) => i > 0 && args[i - 1] === '--sample')) || Number.POSITIVE_INFINITY;
  assert.ok(Number.isInteger(delayMs) && delayMs >= 0, 'delay must be a non-negative integer');
  assert.ok(Number.isInteger(sample) && sample > 0, 'sample must be a positive integer');

  const endpoint = normalizeEndpoint(await loadEnv());
  const fixture = JSON.parse(await readFile(path.join(root, 'tests', 'fixtures', 'ai-chat-eval.json'), 'utf8'));
  const selected = fixture.questions.slice(0, Math.min(sample, fixture.questions.length));

  const results = [];
  for (let i = 0; i < selected.length; i++) {
    const q = selected[i];
    const result = await evaluateModel(endpoint, q);
    results.push(result);
    console.log(`${q.id}: ${result.error ? 'ERROR ' + result.error : 'OK ' + result.answer.slice(0, 40).replace(/\n/g, ' ')}`);
    if (i < selected.length - 1) await sleep(delayMs);
  }

  await mkdir(outputDir, {recursive: true});
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const observed = [...new Set(results.map(r => r.modelObserved).filter(Boolean))].map(m => m.replace(/[^a-zA-Z0-9_-]/g, '_')).join('-') || 'unknown';
  const name = baseline ? `baseline-${timestamp}-${observed}` : `eval-${timestamp}-${observed}`;
  const jsonPath = path.join(outputDir, `${name}.json`);
  const mdPath = path.join(outputDir, `${name}.md`);
  await writeFile(jsonPath, JSON.stringify({endpoint, observed, generatedAt: new Date().toISOString(), results}, null, 2) + '\n');
  await writeFile(mdPath, formatReport(results));
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch(error => {
  console.error(error instanceof assert.AssertionError ? error.message : error);
  process.exitCode = 1;
});
