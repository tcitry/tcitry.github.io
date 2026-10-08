#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertConvexAdminConfigured, runConvexAdminFunction } from './lib/convex-admin.mjs';
import {
  GISCUS_IMPORT_SOURCE,
  buildReactionsPlan,
  collectReactionTargets,
  fetchAnnouncementsDiscussions,
  fetchReactionsByNodeId,
  loadSitePathnames,
  renderReactionsSummary,
} from './lib/giscus-import.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const USAGE = 'Usage: npm run giscus-reactions:prod -- [--dry-run | --apply] [--rollback] [--push] [--output <dir>]';

async function writePlan(plan, outputDir, log) {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'reactions-plan.json');
  await writeFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  log(`Wrote ${jsonPath}`);
  for (const line of renderReactionsSummary(plan)) log(line);
  return jsonPath;
}

export async function runGiscusReactionsProd({
  apply = false,
  rollback = false,
  push = false,
  outputDir = path.join(root, '.generated/giscus-import'),
  log = console.log,
} = {}) {
  if (rollback) {
    if (!apply) {
      log(`Rollback dry run: would delete all articleLikes / commentLikes where importSource = ${GISCUS_IMPORT_SOURCE} and subtract them from commentStats.likeCount / comments.likeCount.`);
      log('Re-run with --rollback --apply and production Convex credentials to execute.');
      return { rollback: true, dryRun: true };
    }
    await assertConvexAdminConfigured(root);
    const result = await runConvexAdminFunction(root, 'giscusImport:rollbackReactions', { importSource: GISCUS_IMPORT_SOURCE }, { push, log });
    log(`Rollback complete: deleted ${result.deleted} imported likes.`);
    return result;
  }

  const site = await loadSitePathnames();
  const discussions = await fetchAnnouncementsDiscussions();
  const nodeIds = collectReactionTargets(discussions, site).map(target => target.nodeId);
  const reactionsByNodeId = await fetchReactionsByNodeId(nodeIds);
  const plan = buildReactionsPlan(discussions, reactionsByNodeId, site);
  await writePlan(plan, outputDir, log);

  if (!apply) {
    log('Dry run only. Production Convex was not modified.');
    return plan;
  }

  assert.equal(plan.unresolved.length, 0, 'Reaction plan has unresolved targets; fix the pathname / comment mapping first.');
  assert.ok(plan.totals.imported.total, 'Reaction plan has no likes to write.');
  await assertConvexAdminConfigured(root);
  const result = await runConvexAdminFunction(root, 'giscusImport:importReactions', {
    articleLikes: plan.articleLikes,
    commentLikes: plan.commentLikes,
    importSource: GISCUS_IMPORT_SOURCE,
  }, { push, log });
  log(`Import complete: inserted ${result.inserted}, skipped ${result.skipped} (already present).`);
  for (const [pathname, count] of Object.entries(result.pathnames)) log(`  ${pathname}: +${count}`);
  for (const [externalId, count] of Object.entries(result.comments)) log(`  comment ${externalId}: +${count}`);
  return { plan, result };
}

if (process.argv[1] && fileURLToPath(new URL(import.meta.url)) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  try {
    const apply = args.includes('--apply');
    const dryRun = args.includes('--dry-run');
    const rollback = args.includes('--rollback');
    const push = args.includes('--push');
    const outputIndex = args.indexOf('--output');
    const outputValue = outputIndex >= 0 ? args[outputIndex + 1] : null;
    assert.ok(args.every((arg, index) => {
      if (arg === '--output') return typeof outputValue === 'string' && outputValue.length > 0;
      if (index > 0 && args[index - 1] === '--output') return true;
      return ['--apply', '--dry-run', '--rollback', '--push'].includes(arg);
    }), USAGE);
    assert.ok(!(apply && dryRun), USAGE);
    await runGiscusReactionsProd({ apply, rollback, push, ...(outputValue ? { outputDir: path.resolve(outputValue) } : {}) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Giscus reactions import failed.');
    process.exitCode = 1;
  }
}
