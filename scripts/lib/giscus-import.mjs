import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeRoute } from '../legacy-content.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const legacyRoutesPath = path.join(root, 'scripts/legacy-routes.json');

export const GITHUB_REPO = { owner: 'tcitry', name: 'tcitry.github.io' };
export const ANNOUNCEMENTS_CATEGORY_ID = 'DIC_kwDOCMyx684COMlk';

/** Synthetic Convex owner for imported GitHub comment authors (no claim flow). */
export function syntheticGithubOwner(databaseId) {
  return `github:user:${databaseId}`;
}

const DISCUSSIONS_QUERY = `
query($owner: String!, $name: String!, $categoryId: ID!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: 50, after: $cursor, categoryId: $categoryId, orderBy: {field: CREATED_AT, direction: ASC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        url
        createdAt
        comments(first: 20) {
          totalCount
          nodes {
            databaseId
            createdAt
            url
            author { login ... on User { databaseId } }
            body
            replies(first: 20) {
              totalCount
              nodes {
                databaseId
                createdAt
                url
                author { login ... on User { databaseId } }
                body
              }
            }
          }
        }
      }
    }
  }
}`;

function ghGraphql(query, variables = {}) {
  const payload = JSON.stringify({ query, variables });
  const output = execFileSync('gh', ['api', 'graphql', '--input', '-'], { encoding: 'utf8', input: payload });
  const parsed = JSON.parse(output);
  if (parsed.errors?.length) throw new Error(parsed.errors.map(error => error.message).join('; '));
  return parsed.data;
}

export async function loadSitePathnames() {
  const legacy = JSON.parse(await readFile(legacyRoutesPath, 'utf8'));
  const urls = new Set(legacy.pages.map(page => canonicalPathname(page.url)).filter(Boolean));
  const byTitle = new Map();
  for (const page of legacy.pages) {
    const pathname = canonicalPathname(page.url);
    if (!pathname || !page.title) continue;
    const key = page.title.trim().toLowerCase();
    const list = byTitle.get(key) ?? [];
    list.push({ pathname, title: page.title, source: page.source ?? null });
    byTitle.set(key, list);
  }
  return { urls, byTitle, legacyPages: legacy.pages };
}

export function canonicalPathname(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
  try {
    return encodeRoute(normalized);
  } catch {
    return null;
  }
}

/** Parse giscus discussion titles like `Title · posts/foo/` or bare `posts/foo/`. */
export function parseDiscussionPathTerms(title) {
  const parts = String(title).split(' · ').map(part => part.trim()).filter(Boolean);
  if (parts.length <= 1) return parts.filter(part => /^(docs|posts|weekly|links)\/.+\/?$/i.test(part) || part === 'about/');
  return parts.slice(1).filter(part => part.endsWith('/') || /^(docs|posts|weekly|links)\//i.test(part));
}

export function pathTermsToCandidates(terms) {
  return [...new Set(terms.map(term => canonicalPathname(term)).filter(Boolean))];
}

export const KNOWN_DISCUSSION_RISKS = {
  148: {
    kind: 'dual_path',
    summary: 'Discussion title lists two pathname terms; only one should receive imported comments.',
    candidates: [
      '/docs/Xcode/SwiftUI/View/TabView/',
      '/docs/Apple/SwiftUI/Layout/TabView/',
    ],
    note: 'Legacy site has /docs/Apple/SwiftUI/Layout/TabView/; Xcode path is absent from legacy-routes.json.',
  },
  160: {
    kind: 'mangled_slug',
    summary: 'Giscus term uses a long percent-encoded slug that does not match the canonical article pathname.',
    candidates: [
      '/posts/Clash-Verge-RevClash-Party-%E4%B8%8E-Surge-Mac-6macOS-%E4%BB%A3%E7%90%86%E5%AE%A2%E6%88%B7%E7%AB%AF%E6%80%8E%E4%B9%88%E9%80%89/',
    ],
    suggestedPathname: '/posts/macos-proxy-client-comparison/',
    note: 'Canonical article pathname is /posts/macos-proxy-client-comparison/.',
  },
};

function flattenComments(comments) {
  const rows = [];
  for (const comment of comments.nodes ?? []) {
    rows.push({ ...comment, parentDatabaseId: null });
    for (const reply of comment.replies?.nodes ?? []) rows.push({ ...reply, parentDatabaseId: comment.databaseId });
  }
  return rows;
}

export async function fetchAnnouncementsDiscussions() {
  const discussions = [];
  let cursor = null;
  for (;;) {
    const data = ghGraphql(DISCUSSIONS_QUERY, {
      owner: GITHUB_REPO.owner,
      name: GITHUB_REPO.name,
      categoryId: ANNOUNCEMENTS_CATEGORY_ID,
      cursor,
    });
    const connection = data.repository.discussions;
    discussions.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }
  return discussions;
}

function titlePathnameFallback(title, site) {
  const key = title.split(' · ')[0]?.trim().toLowerCase();
  if (!key) return null;
  const matches = site.byTitle.get(key) ?? [];
  if (matches.length === 1) return matches[0].pathname;
  return null;
}

export function proposeDiscussionMapping(discussion, site) {
  const terms = parseDiscussionPathTerms(discussion.title);
  const candidates = pathTermsToCandidates(terms);
  const known = KNOWN_DISCUSSION_RISKS[discussion.number];
  const matched = candidates.filter(pathname => site.urls.has(pathname));
  const unmatched = candidates.filter(pathname => !site.urls.has(pathname));
  const titleFallback = matched.length === 0 ? titlePathnameFallback(discussion.title, site) : null;
  const comments = flattenComments(discussion.comments);
  const risks = [];

  if (known) risks.push({ code: known.kind, ...known });
  if (candidates.length > 1 && matched.length !== 1) {
    risks.push({
      code: 'multiple_terms',
      summary: 'Discussion title contains multiple pathname terms.',
      candidates,
      matched,
      unmatched,
    });
  }
  for (const pathname of unmatched) {
    risks.push({ code: 'unknown_path', summary: 'Path term is not present in legacy-routes.json.', pathname });
  }

  let proposedPathname = null;
  let proposalReason = null;
  if (known?.suggestedPathname) {
    proposedPathname = known.suggestedPathname;
    proposalReason = 'known_override';
  } else if (matched.length === 1) {
    proposedPathname = matched[0];
    proposalReason = candidates.length > 1 ? 'single_valid_legacy_match' : 'title_term';
  } else if (matched.length > 1) {
    proposalReason = 'needs_manual_choice';
  } else if (titleFallback) {
    proposedPathname = titleFallback;
    proposalReason = 'title_fallback';
  } else if (candidates.length === 1 && candidates[0] === '/about/') {
    proposedPathname = '/about/';
    proposalReason = 'about_page';
  }

  return {
    discussionNumber: discussion.number,
    title: discussion.title,
    discussionUrl: discussion.url,
    createdAt: discussion.createdAt,
    titleTerms: terms,
    candidatePathnames: candidates,
    matchedPathnames: matched,
    unmatchedPathnames: unmatched,
    proposedPathname,
    proposalReason,
    risks,
    commentCount: comments.length,
    topLevelCommentCount: discussion.comments.totalCount,
    comments: comments.map(row => ({
      externalId: String(row.databaseId),
      sourceUrl: row.url,
      createdAt: row.createdAt,
      parentExternalId: row.parentDatabaseId == null ? null : String(row.parentDatabaseId),
      githubLogin: row.author?.login ?? null,
      githubUserId: row.author?.databaseId ?? null,
      owner: row.author?.databaseId == null ? null : syntheticGithubOwner(row.author.databaseId),
      bodyPreview: String(row.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
    })),
  };
}

export function buildDryRunReport(discussions, site) {
  const mappings = discussions.map(discussion => proposeDiscussionMapping(discussion, site));
  const importableComments = mappings.flatMap(row => row.comments);
  const nonEmptyThreads = mappings.filter(row => row.commentCount > 0);
  const needsReview = mappings.filter(row => !row.proposedPathname || row.risks.length > 0);
  return {
    generatedAt: new Date().toISOString(),
    repository: `${GITHUB_REPO.owner}/${GITHUB_REPO.name}`,
    category: 'Announcements',
    totals: {
      discussions: mappings.length,
      nonEmptyThreads: nonEmptyThreads.length,
      commentsAndReplies: importableComments.length,
      needsReview: needsReview.length,
    },
    mappings,
    summary: {
      ready: mappings.filter(row => row.proposedPathname && row.risks.length === 0).map(row => ({
        discussionNumber: row.discussionNumber,
        proposedPathname: row.proposedPathname,
        commentCount: row.commentCount,
      })),
      needsReview: needsReview.map(row => ({
        discussionNumber: row.discussionNumber,
        title: row.title,
        proposedPathname: row.proposedPathname,
        risks: row.risks.map(risk => risk.code),
        commentCount: row.commentCount,
      })),
    },
  };
}

export function renderDryRunMarkdown(report) {
  const lines = [
    '# Giscus / GitHub Discussions import dry-run',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'This report is read-only. Production Convex is untouched until pathname mappings are approved.',
    '',
    '## Totals',
    '',
    `- Discussions: ${report.totals.discussions}`,
    `- Non-empty threads: ${report.totals.nonEmptyThreads}`,
    `- Comments + replies: ${report.totals.commentsAndReplies}`,
    `- Needs review: ${report.totals.needsReview}`,
    '',
    '## Mapping table',
    '',
    '| # | Discussion title | Proposed pathname | Comments | Status |',
    '| -: | --- | --- | --: | --- |',
  ];

  for (const row of report.mappings) {
    const status = !row.proposedPathname
      ? 'needs review'
      : row.risks.length
        ? 'proposed with risks'
        : 'ready';
    lines.push(`| ${row.discussionNumber} | ${row.title.replace(/\|/g, '\\|')} | ${row.proposedPathname ?? '—'} | ${row.commentCount} | ${status} |`);
  }

  lines.push('', '## Flagged risks', '');
  const flagged = report.mappings.filter(row => row.risks.length);
  if (!flagged.length) lines.push('None.');
  for (const row of flagged) {
    lines.push(`### #${row.discussionNumber} ${row.title}`, '');
    for (const risk of row.risks) {
      lines.push(`- **${risk.code}**: ${risk.summary}`);
      if (risk.candidates?.length) lines.push(`  - candidates: ${risk.candidates.join(', ')}`);
      if (risk.suggestedPathname) lines.push(`  - suggested: ${risk.suggestedPathname}`);
      if (risk.note) lines.push(`  - note: ${risk.note}`);
    }
    lines.push('');
  }

  lines.push('## Import owner convention', '', 'Imported rows will use `owner = github:user:{GitHubUser.databaseId}` and `externalId = {Comment.databaseId}` for idempotent re-import.', '');
  return lines.join('\n');
}
