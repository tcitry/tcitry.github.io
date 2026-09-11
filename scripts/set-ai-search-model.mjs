#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));

const ALLOWLIST = new Set([
  '@cf/qwen/qwen3.8-27b',
  '@cf/zai-org/glm-5.3-flash',
  '@cf/deepseek-ai/deepseek-v4-flash-0731',
]);

async function loadEnv() {
  let text = '';
  try { text = await readFile(path.join(root, '.env.local'), 'utf8'); } catch {}
  const env = parseEnv(text);
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  assert.ok(accountId && /^[a-f0-9]{32}$/.test(accountId), 'Set CLOUDFLARE_ACCOUNT_ID in .env.local');
  assert.ok(token, 'Set CLOUDFLARE_API_TOKEN in .env.local');
  return {accountId, token};
}

async function main() {
  const args = process.argv.slice(2);
  const model = args[0];
  assert.ok(model, 'Usage: node scripts/set-ai-search-model.mjs <model-id>');
  assert.ok(ALLOWLIST.has(model), `Unknown model. Allowed: ${[...ALLOWLIST].join(', ')}`);

  const {accountId, token} = await loadEnv();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-search/instances/tcitry-blog-search`;

  const getResponse = await fetch(url, {headers: {authorization: `Bearer ${token}`}});
  assert.equal(getResponse.status, 200, `Failed to fetch instance: ${await getResponse.text().catch(() => '')}`);
  const before = await getResponse.json();
  const beforeModel = before.result?.ai_search_model ?? '(unset)';
  console.log(`Current ai_search_model: ${beforeModel}`);

  const update = await fetch(url, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ai_search_model: model}),
  });
  const body = await update.json();
  assert.equal(update.status, 200, `Failed to update instance: ${JSON.stringify(body)}`);
  console.log(`Updated tcitry-blog-search ai_search_model to: ${model}`);
  console.log(`Next: run "npm run ai-chat:eval:quick" or "npm run ai-chat:eval:baseline" to compare.`);
}

main().catch(error => {
  console.error(error instanceof assert.AssertionError ? error.message : error);
  process.exitCode = 1;
});
