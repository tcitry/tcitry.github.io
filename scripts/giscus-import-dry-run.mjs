#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDryRunReport,
  fetchAnnouncementsDiscussions,
  loadSitePathnames,
  renderDryRunMarkdown,
} from './lib/giscus-import.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDir = process.argv.includes('--output')
  ? path.resolve(process.argv[process.argv.indexOf('--output') + 1])
  : path.join(root, '.generated/giscus-import');

try {
  const site = await loadSitePathnames();
  const discussions = await fetchAnnouncementsDiscussions();
  const report = buildDryRunReport(discussions, site);
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'mapping-report.json');
  const markdownPath = path.join(outputDir, 'mapping-report.md');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, `${renderDryRunMarkdown(report)}\n`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
  console.log(`Discussions: ${report.totals.discussions}; comments+replies: ${report.totals.commentsAndReplies}; needs review: ${report.totals.needsReview}`);
  if (report.totals.needsReview > 0) process.exitCode = 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Giscus import dry-run failed.');
  process.exitCode = 1;
}
