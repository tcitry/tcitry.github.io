import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_REACTION_OPTIONS,
  assertDiscussionsComplete,
  buildReactionsPlan,
  collectReactionTargets,
} from '../scripts/lib/giscus-import.mjs';

const site = {
  urls: new Set(['/about/', '/posts/example/']),
  byTitle: new Map(),
  legacyPages: [
    { url: '/about/', title: '关于' },
    { url: '/posts/example/', title: 'Example' },
  ],
};

const groups = counts => Object.entries(counts).map(([content, totalCount]) => ({ content, reactors: { totalCount } }));
const user = (login, databaseId) => ({ login, databaseId });
const reaction = (content, reactor, createdAt = '2024-01-01T00:00:00Z') => ({ content, createdAt, user: reactor });

function discussions() {
  return [
    {
      id: 'D_about', number: 143, title: '关于 · about/', url: 'https://github.com/x/143', createdAt: '2023-01-01T00:00:00Z',
      reactionGroups: groups({ THUMBS_UP: 3, HEART: 1, THUMBS_DOWN: 1, CONFUSED: 1 }),
      comments: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
    },
    {
      id: 'D_example', number: 150, title: 'Example · posts/example/', url: 'https://github.com/x/150', createdAt: '2023-01-01T00:00:00Z',
      reactionGroups: [],
      comments: {
        totalCount: 1,
        pageInfo: { hasNextPage: false },
        nodes: [{
          id: 'C_1', databaseId: 1001, createdAt: '2023-01-02T00:00:00Z', url: 'https://github.com/x/150#1001',
          author: user('reader', 42), body: 'hello', reactionGroups: groups({ LAUGH: 2 }),
          replies: {
            totalCount: 2,
            pageInfo: { hasNextPage: false },
            nodes: [
              { id: 'R_1', databaseId: 1002, createdAt: '2023-01-03T00:00:00Z', url: 'https://github.com/x/150#1002', author: user('tcitry', 5220740), body: 'reply', reactionGroups: groups({ ROCKET: 1 }) },
              { id: 'R_ghost', databaseId: 1003, createdAt: '2023-01-04T00:00:00Z', url: 'https://github.com/x/150#1003', author: null, body: 'ghost reply', reactionGroups: groups({ EYES: 1 }) },
            ],
          },
        }],
      },
    },
  ];
}

const reactions = new Map([
  ['D_about', [
    reaction('THUMBS_UP', user('Kazekumo', 1), '2024-01-02T00:00:00Z'),
    reaction('HEART', user('Kazekumo', 1), '2024-01-01T00:00:00Z'),
    reaction('THUMBS_UP', user('Young1108', 2)),
    reaction('THUMBS_UP', user('tcitry', 5220740)),
    reaction('THUMBS_DOWN', user('grumpy', 3)),
    reaction('CONFUSED', null),
  ]],
  ['C_1', [reaction('LAUGH', user('renamed-owner', 5220740)), reaction('LAUGH', user('friend', 7))]],
  ['R_1', [reaction('ROCKET', user('friend', 7))]],
  ['R_ghost', [reaction('EYES', user('friend', 7))]],
]);

test('reaction targets use approved pathnames and only reacted nodes', () => {
  const targets = collectReactionTargets(discussions(), site);
  assert.deepEqual(targets.map(target => [target.type, target.nodeId, target.pathname, target.resolved]), [
    ['article', 'D_about', '/about/', true],
    ['comment', 'C_1', '/posts/example/', true],
    ['comment', 'R_1', '/posts/example/', true],
    ['comment', 'R_ghost', '/posts/example/', false],
  ]);
  assert.equal(targets[0].title, '关于');
});

test('reactions map to deduplicated likes excluding owner, negatives and ghosts', () => {
  const plan = buildReactionsPlan(discussions(), reactions, site);
  assert.deepEqual(plan.articleLikes, [
    { pathname: '/about/', owner: 'github:user:1', title: '关于', createdAt: Date.parse('2024-01-01T00:00:00Z') },
    { pathname: '/about/', owner: 'github:user:2', title: '关于', createdAt: Date.parse('2024-01-01T00:00:00Z') },
  ]);
  assert.deepEqual(plan.commentLikes, [
    { externalId: '1001', owner: 'github:user:7' },
    { externalId: '1002', owner: 'github:user:7' },
  ]);
  assert.deepEqual(plan.totals.raw, {
    total: 10,
    byContent: { HEART: 1, THUMBS_UP: 3, THUMBS_DOWN: 1, CONFUSED: 1, LAUGH: 2, ROCKET: 1, EYES: 1 },
    byTargetType: { article: 6, comment: 4 },
  });
  assert.deepEqual(plan.totals.excluded, { total: 5, excluded_user: 2, negative: 1, ghost: 1, duplicate: 1 });
  assert.deepEqual(plan.totals.imported, { total: 4, articleLikes: 2, commentLikes: 2 });
  assert.deepEqual(plan.options.excludedUserIds, [5220740]);
  assert.equal(plan.excludedReactions.find(row => row.reason === 'excluded_user' && row.type === 'comment').githubLogin, 'renamed-owner');
});

test('reactions on comments that are not part of the comment import are reported as unresolved', () => {
  const plan = buildReactionsPlan(discussions(), reactions, site);
  assert.deepEqual(plan.unresolved.map(target => [target.externalId, target.likes]), [['1003', 1]]);
  assert.ok(!plan.commentLikes.some(row => row.externalId === '1003'));
});

test('exclusion list and negative contents are configurable', () => {
  const plan = buildReactionsPlan(discussions(), reactions, site, {
    excludedContents: [],
    excludedLogins: ['Kazekumo'],
    excludedUserIds: [],
  });
  assert.deepEqual(plan.articleLikes.map(row => row.owner), ['github:user:2', 'github:user:5220740', 'github:user:3']);
  assert.equal(plan.totals.excluded.negative, 0);
  assert.equal(plan.totals.excluded.excluded_user, 2);
  assert.deepEqual(DEFAULT_REACTION_OPTIONS.excludedLogins, ['tcitry']);
});

test('missing second-pass reactions fail instead of importing partial data', () => {
  assert.throws(() => buildReactionsPlan(discussions(), new Map(), site), /were not fetched/);
});

test('truncated comment or reply pages fail the fetch', () => {
  const truncatedComments = discussions();
  truncatedComments[1].comments.pageInfo.hasNextPage = true;
  assert.throws(() => assertDiscussionsComplete(truncatedComments), /more than 1 comments/);
  const truncatedReplies = discussions();
  truncatedReplies[1].comments.nodes[0].replies.pageInfo.hasNextPage = true;
  assert.throws(() => assertDiscussionsComplete(truncatedReplies), /more than 2 replies/);
  assert.doesNotThrow(() => assertDiscussionsComplete(discussions()));
});
