import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

let evalModule;
async function loadEvalModule() {
  return evalModule ??= await import('../scripts/eval-ai-chat.mjs');
}

test('importing the eval module does not run main without an endpoint', async () => {
  const endpoint = process.env.AI_SEARCH_PUBLIC_URL;
  delete process.env.AI_SEARCH_PUBLIC_URL;
  try {
    evalModule = await import('../scripts/eval-ai-chat.mjs');
    assert.equal(typeof evalModule.createTurnTimer, 'function');
  } finally {
    if (endpoint === undefined) delete process.env.AI_SEARCH_PUBLIC_URL;
    else process.env.AI_SEARCH_PUBLIC_URL = endpoint;
  }
});

test('createTurnTimer measures headers, first visible text, and total duration', async () => {
  const {createTurnTimer} = await loadEvalModule();
  let now = 0;
  const timer = createTurnTimer(() => now);

  now = 100;
  timer.headers();
  assert.equal(timer.timing.headersMs, 100);
  now = 200;
  timer.visibleText('');
  timer.visibleText('  ');
  assert.equal(timer.timing.ttfbMs, null);
  now = 300;
  timer.visibleText('你');
  assert.equal(timer.timing.ttfbMs, 300);
  now = 400;
  timer.visibleText('好');
  assert.equal(timer.timing.ttfbMs, 300);
  now = 500;
  timer.finish();
  assert.equal(timer.timing.totalMs, 500);
});

test('percentile ignores non-finite values and handles empty input', async () => {
  const {percentile} = await loadEvalModule();
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 90), 40);
  assert.equal(percentile([10, Number.NaN, Number.POSITIVE_INFINITY, 20, 30, 40], 90), 40);
});

test('summarize counts turns, retrieval mismatches, and category rates', async () => {
  const {summarize} = await loadEvalModule();
  const summary = summarize([
    {
      id: 'q-no-retrieval',
      category: 'no-retrieval',
      expectRetrieval: false,
      turns: [{toolCalled: true, augmented: false, ttfbMs: 100, totalMs: 200, headersMs: 50}],
    },
    {
      id: 'q-single-fact',
      category: 'single-fact',
      expectRetrieval: true,
      turns: [
        {toolCalled: false, augmented: false, ttfbMs: 120, totalMs: 220, headersMs: 60},
        {toolCalled: false, augmented: false, ttfbMs: 130, totalMs: 230, headersMs: 70, error: 'x'},
      ],
    },
  ]);

  assert.equal(summary.turns, 3);
  assert.equal(summary.okTurns, 2);
  assert.equal(summary.unexpectedRetrieval, 1);
  assert.equal(summary.missingRetrieval, 1);
  assert.equal(summary.categories['no-retrieval'].toolCallRate, 1);
});

test('AI chat evaluation fixture has valid ids, turns, categories, and models', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/ai-chat-eval.json', import.meta.url), 'utf8'));
  const ids = new Set();
  for (const question of fixture.questions) {
    assert.equal(typeof question.id, 'string');
    assert.ok(question.id);
    assert.equal(ids.has(question.id), false, `duplicate question id: ${question.id}`);
    ids.add(question.id);
    assert.ok(Array.isArray(question.turns) && question.turns.length > 0, `${question.id} must have turns`);
    if (question.category === 'no-retrieval') {
      assert.equal(question.expectRetrieval, false, `${question.id} must not expect retrieval`);
      assert.deepEqual(question.expectedSourcePatterns, [], `${question.id} must have no source patterns`);
    }
  }
  assert.ok(fixture.models.includes('@cf/zai-org/glm-5.3'));
});
