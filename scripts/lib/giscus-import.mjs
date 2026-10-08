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

const REACTION_GROUPS_FIELDS = 'reactionGroups { content reactors { totalCount } }';

const DISCUSSIONS_QUERY = `
query($owner: String!, $name: String!, $categoryId: ID!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: 50, after: $cursor, categoryId: $categoryId, orderBy: {field: CREATED_AT, direction: ASC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        databaseId
        number
        title
        url
        createdAt
        ${REACTION_GROUPS_FIELDS}
        comments(first: 20) {
          totalCount
          pageInfo { hasNextPage }
          nodes {
            id
            databaseId
            createdAt
            url
            author { login ... on User { databaseId } }
            body
            ${REACTION_GROUPS_FIELDS}
            replies(first: 20) {
              totalCount
              pageInfo { hasNextPage }
              nodes {
                id
                databaseId
                createdAt
                url
                author { login ... on User { databaseId } }
                body
                ${REACTION_GROUPS_FIELDS}
              }
            }
          }
        }
      }
    }
  }
}`;

const REACTIONS_BATCH_SIZE = 50;

const REACTIONS_QUERY = `
query($ids: [ID!]!) {
  nodes(ids: $ids) {
    id
    ... on Reactable {
      reactions(first: 100) {
        totalCount
        pageInfo { hasNextPage }
        nodes { content createdAt user { login databaseId } }
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

/** Locked production pathname overrides approved for DEV-76. */
export const APPROVED_PATHNAME_OVERRIDES = {
  148: '/docs/Apple/SwiftUI/Layout/TabView/',
  160: '/posts/macos-proxy-client-comparison/',
};

export const GISCUS_IMPORT_SOURCE = 'github_discussion';

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

/** Fail instead of importing a silently truncated comments/replies page. */
export function assertDiscussionsComplete(discussions) {
  for (const discussion of discussions) {
    if (discussion.comments?.pageInfo?.hasNextPage) {
      throw new Error(`Discussion #${discussion.number} has more than ${discussion.comments.nodes.length} comments; paginate before importing.`);
    }
    for (const comment of discussion.comments?.nodes ?? []) {
      if (comment.replies?.pageInfo?.hasNextPage) {
        throw new Error(`Comment ${comment.databaseId} in discussion #${discussion.number} has more than ${comment.replies.nodes.length} replies; paginate before importing.`);
      }
    }
  }
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
    assertDiscussionsComplete(connection.nodes);
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
      body: String(row.body ?? ''),
      bodyPreview: String(row.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
    })),
  };
}

export function importAuthorName(githubLogin, githubUserId) {
  if (typeof githubLogin === 'string') {
    const trimmed = githubLogin.trim();
    if (trimmed && trimmed.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(trimmed)) return trimmed;
  }
  if (githubUserId != null) return `GitHub#${githubUserId}`;
  return 'GitHub用户';
}

export function resolveImportPathname(mapping) {
  const override = APPROVED_PATHNAME_OVERRIDES[mapping.discussionNumber];
  if (override) return override;
  return mapping.proposedPathname;
}

export function isApprovedForImport(mapping) {
  const pathname = resolveImportPathname(mapping);
  if (!pathname) return false;
  if (APPROVED_PATHNAME_OVERRIDES[mapping.discussionNumber]) return true;
  return mapping.risks.length === 0;
}

export function buildProductionImportPlan(discussions, site) {
  const mappings = discussions.map(discussion => proposeDiscussionMapping(discussion, site));
  const selected = mappings.filter(mapping => isApprovedForImport(mapping) && mapping.comments.length > 0);
  const rows = selected.flatMap(mapping => {
    const pathname = resolveImportPathname(mapping);
    return mapping.comments
      .filter(comment => comment.owner && comment.externalId)
      .map(comment => ({
        pathname,
        externalId: comment.externalId,
        body: comment.body,
        createdAt: Date.parse(comment.createdAt),
        parentExternalId: comment.parentExternalId,
        owner: comment.owner,
        authorName: importAuthorName(comment.githubLogin, comment.githubUserId),
        sourceDiscussionNumber: mapping.discussionNumber,
        githubLogin: comment.githubLogin ?? undefined,
        githubUserId: comment.githubUserId ?? undefined,
        sourceUrl: comment.sourceUrl ?? undefined,
      }))
      .filter(row => Number.isFinite(row.createdAt));
  });
  return {
    generatedAt: new Date().toISOString(),
    importSource: GISCUS_IMPORT_SOURCE,
    totals: {
      discussions: mappings.length,
      approvedDiscussions: selected.length,
      commentsAndReplies: rows.length,
    },
    pathnameOverrides: APPROVED_PATHNAME_OVERRIDES,
    selectedDiscussions: selected.map(mapping => ({
      discussionNumber: mapping.discussionNumber,
      pathname: resolveImportPathname(mapping),
      commentCount: mapping.comments.length,
      override: Boolean(APPROVED_PATHNAME_OVERRIDES[mapping.discussionNumber]),
    })),
    rows,
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

export const DEFAULT_REACTION_OPTIONS = Object.freeze({
  excludedContents: Object.freeze(['THUMBS_DOWN', 'CONFUSED']),
  excludedLogins: Object.freeze(['tcitry']),
  excludedUserIds: Object.freeze([5220740]),
});

export const REACTION_EXCLUSION_REASONS = ['excluded_user', 'negative', 'ghost', 'duplicate'];

function reactionTotal(node) {
  return (node.reactionGroups ?? []).reduce((sum, group) => sum + (group.reactors?.totalCount ?? 0), 0);
}

function legacyTitlesByPathname(site) {
  const titles = new Map();
  for (const page of site.legacyPages ?? []) {
    const pathname = canonicalPathname(page.url);
    const title = typeof page.title === 'string' ? page.title.trim() : '';
    if (pathname && title && title.length <= 160 && !titles.has(pathname)) titles.set(pathname, title);
  }
  return titles;
}

/** Discussion bodies and comments/replies that carry at least one reaction, with their import targets. */
export function collectReactionTargets(discussions, site) {
  const titles = legacyTitlesByPathname(site);
  const importedComments = new Set(buildProductionImportPlan(discussions, site).rows.map(row => row.externalId));
  const targets = [];
  for (const discussion of discussions) {
    const mapping = proposeDiscussionMapping(discussion, site);
    const pathname = isApprovedForImport(mapping) ? resolveImportPathname(mapping) : null;
    if (reactionTotal(discussion) > 0) {
      targets.push({
        type: 'article',
        nodeId: discussion.id,
        discussionNumber: discussion.number,
        pathname,
        title: pathname ? titles.get(pathname) ?? null : null,
        resolved: Boolean(pathname),
      });
    }
    for (const comment of flattenComments(discussion.comments)) {
      if (reactionTotal(comment) === 0) continue;
      const externalId = String(comment.databaseId);
      targets.push({
        type: 'comment',
        nodeId: comment.id,
        discussionNumber: discussion.number,
        pathname,
        externalId,
        resolved: Boolean(pathname) && importedComments.has(externalId),
      });
    }
  }
  return targets;
}

/** Second GraphQL pass: fetch reactions only for nodes that have any, via `nodes(ids:)`. */
export async function fetchReactionsByNodeId(nodeIds) {
  const reactions = new Map();
  for (let index = 0; index < nodeIds.length; index += REACTIONS_BATCH_SIZE) {
    const ids = nodeIds.slice(index, index + REACTIONS_BATCH_SIZE);
    const data = ghGraphql(REACTIONS_QUERY, { ids });
    data.nodes.forEach((node, position) => {
      if (!node?.reactions) throw new Error(`GitHub node ${ids[position]} is missing or not reactable.`);
      if (node.reactions.pageInfo.hasNextPage) throw new Error(`GitHub node ${node.id} has more than ${node.reactions.nodes.length} reactions; paginate before importing.`);
      reactions.set(node.id, node.reactions.nodes);
    });
  }
  return reactions;
}

function emptyCounts(keys) {
  return Object.fromEntries(keys.map(key => [key, 0]));
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

/**
 * Map giscus reactions to site likes: one like per (target, GitHub user) for
 * counted contents, skipping excluded users (by login and databaseId), ghosts
 * and negative contents.
 */
export function buildReactionsPlan(discussions, reactionsByNodeId, site, options = DEFAULT_REACTION_OPTIONS) {
  const excludedContents = new Set(options.excludedContents);
  const excludedLogins = new Set(options.excludedLogins.map(login => login.toLowerCase()));
  const excludedUserIds = new Set(options.excludedUserIds.map(Number));
  for (const reactions of reactionsByNodeId.values()) {
    for (const reaction of reactions) {
      if (reaction.user?.databaseId != null && excludedLogins.has(String(reaction.user.login).toLowerCase())) {
        excludedUserIds.add(reaction.user.databaseId);
      }
    }
  }

  const raw = { total: 0, byContent: {}, byTargetType: { article: 0, comment: 0 } };
  const excluded = emptyCounts(REACTION_EXCLUSION_REASONS);
  const excludedReactions = [];
  const articleLikes = [];
  const commentLikes = [];
  const targets = [];

  for (const target of collectReactionTargets(discussions, site)) {
    const reactions = reactionsByNodeId.get(target.nodeId);
    if (!reactions) throw new Error(`Reactions for GitHub node ${target.nodeId} were not fetched.`);
    const sorted = [...reactions].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    const seen = new Set();
    const accepted = [];
    const targetExcluded = emptyCounts(REACTION_EXCLUSION_REASONS);
    const ref = target.type === 'article'
      ? { type: 'article', discussionNumber: target.discussionNumber, pathname: target.pathname }
      : { type: 'comment', discussionNumber: target.discussionNumber, pathname: target.pathname, externalId: target.externalId };

    for (const reaction of sorted) {
      raw.total += 1;
      increment(raw.byContent, reaction.content);
      increment(raw.byTargetType, target.type);
      const user = reaction.user;
      let reason = null;
      if (!user || user.databaseId == null) reason = 'ghost';
      else if (excludedUserIds.has(user.databaseId) || excludedLogins.has(String(user.login).toLowerCase())) reason = 'excluded_user';
      else if (excludedContents.has(reaction.content)) reason = 'negative';
      else if (seen.has(user.databaseId)) reason = 'duplicate';
      if (reason) {
        increment(excluded, reason);
        increment(targetExcluded, reason);
        excludedReactions.push({ ...ref, reason, content: reaction.content, githubLogin: user?.login ?? null, createdAt: reaction.createdAt });
        continue;
      }
      seen.add(user.databaseId);
      accepted.push({ owner: syntheticGithubOwner(user.databaseId), githubLogin: user.login, createdAt: Date.parse(reaction.createdAt) });
    }

    targets.push({ ...ref, resolved: target.resolved, raw: sorted.length, likes: accepted.length, githubLogins: accepted.map(like => like.githubLogin), excluded: targetExcluded });
    if (!target.resolved) continue;
    for (const like of accepted) {
      if (target.type === 'article') {
        articleLikes.push({ pathname: target.pathname, owner: like.owner, ...(target.title ? { title: target.title } : {}), createdAt: like.createdAt });
      } else {
        commentLikes.push({ externalId: target.externalId, owner: like.owner });
      }
    }
  }

  const unresolved = targets.filter(target => !target.resolved && target.likes > 0);
  const excludedTotal = Object.values(excluded).reduce((sum, count) => sum + count, 0);
  return {
    generatedAt: new Date().toISOString(),
    importSource: GISCUS_IMPORT_SOURCE,
    options: {
      excludedContents: [...excludedContents],
      excludedLogins: [...excludedLogins],
      excludedUserIds: [...excludedUserIds],
    },
    totals: {
      raw,
      excluded: { total: excludedTotal, ...excluded },
      imported: { total: articleLikes.length + commentLikes.length, articleLikes: articleLikes.length, commentLikes: commentLikes.length },
      unresolved: unresolved.length,
    },
    targets,
    unresolved,
    excludedReactions,
    articleLikes,
    commentLikes,
  };
}

export function renderReactionsSummary(plan) {
  const { raw, excluded, imported } = plan.totals;
  const byContent = Object.entries(raw.byContent).map(([content, count]) => `${content} ${count}`).join(', ') || 'none';
  const lines = [
    `Raw reactions: ${raw.total} (article ${raw.byTargetType.article}, comment ${raw.byTargetType.comment}; ${byContent})`,
    `Excluded: ${excluded.total} (${REACTION_EXCLUSION_REASONS.map(reason => `${reason} ${excluded[reason]}`).join(', ')})`,
    `Importing: ${imported.total} likes (article ${imported.articleLikes}, comment ${imported.commentLikes})`,
  ];
  for (const target of plan.targets) {
    const label = target.type === 'article'
      ? `article #${target.discussionNumber} ${target.pathname ?? '(unmapped)'}`
      : `comment ${target.externalId} (#${target.discussionNumber} ${target.pathname ?? '(unmapped)'})`;
    const excludedLabel = REACTION_EXCLUSION_REASONS.filter(reason => target.excluded[reason]).map(reason => `${reason} ${target.excluded[reason]}`).join(', ');
    const logins = target.githubLogins.length ? ` [${target.githubLogins.join(', ')}]` : '';
    lines.push(`  ${label}: +${target.likes}${logins}${excludedLabel ? `; excluded ${excludedLabel}` : ''}${target.resolved ? '' : '; UNRESOLVED'}`);
  }
  if (plan.unresolved.length) lines.push(`Unresolved targets: ${plan.unresolved.length} (not in the approved comment import; apply is blocked)`);
  return lines;
}
