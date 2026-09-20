#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertConvexAdminConfigured, runConvexAdminFunction } from './lib/convex-admin.mjs';
import {
  GISCUS_IMPORT_SOURCE,
  buildProductionImportPlan,
  fetchAnnouncementsDiscussions,
  loadSitePathnames,
} from './lib/giscus-import.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDir = process.argv.includes('--output')
  ? path.resolve(process.argv[process.argv.indexOf('--output') + 1])
  : path.join(root, '.generated/giscus-import');
const USAGE = 'Usage: npm run giscus-import:prod -- [--dry-run | --apply] [--rollback] [--push]';

async function writePlan(plan) {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'import-plan.json');
  await writeFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Approved discussions: ${plan.totals.approvedDiscussions}; comments+replies: ${plan.totals.commentsAndReplies}`);
  for (const row of plan.selectedDiscussions) {
    const label = row.override ? 'override' : 'ready';
    console.log(`  #${row.discussionNumber} → ${row.pathname} (${row.commentCount} comments, ${label})`);
  }
  return jsonPath;
}

export async function runGiscusImportProd({ apply = false, rollback = false, push = false, log = console.log } = {}) {
  if (rollback) {
    if (!apply) {
      log('Rollback dry run: would delete all comments where importSource = github_discussion.');
      log('Re-run with --rollback --apply and production Convex credentials to execute.');
      return { rollback: true, dryRun: true };
    }
    await assertConvexAdminConfigured(root);
    const result = await runConvexAdminFunction(root, 'giscusImport:rollback', { importSource: GISCUS_IMPORT_SOURCE }, { push, log });
    log(`Rollback complete: deleted ${result.deleted} imported comments.`);
    return result;
  }

  const site = await loadSitePathnames();
  const discussions = await fetchAnnouncementsDiscussions();
  const plan = buildProductionImportPlan(discussions, site);
  await writePlan(plan);

  if (!apply) {
    log('Dry run only. Production Convex was not modified.');
    log('Re-run with --apply and production Convex credentials after the import mutations are deployed.');
    return plan;
  }

  assert.ok(plan.rows.length, 'Import plan has no comments to write.');
  await assertConvexAdminConfigured(root);
  const result = await runConvexAdminFunction(root, 'giscusImport:importBatch', {
    rows: plan.rows,
    importSource: GISCUS_IMPORT_SOURCE,
  }, { push, log });
  log(`Import complete: inserted ${result.inserted}, skipped ${result.skipped} (already present).`);
  if (result.pathnames && Object.keys(result.pathnames).length) {
    for (const [pathname, count] of Object.entries(result.pathnames)) log(`  ${pathname}: +${count}`);
  }
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
    assert.ok(rollback ? apply : true, 'Rollback requires --apply.');
    await runGiscusImportProd({ apply: rollback ? true : apply, rollback, push });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Giscus production import failed.');
    process.exitCode = 1;
  }
}
