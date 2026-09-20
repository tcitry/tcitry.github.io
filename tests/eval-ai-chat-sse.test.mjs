import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consumeCompletionSseBuffer,
  mapChunkSources,
  parseCompletionSseFrame,
} from '../src/lib/ai-search-completion-sse.mjs';

const item = {
  item: {
    key: 'tcitry-blog/articles/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md',
    metadata: {
      canonical_url: 'https://yindongliang.com/docs/ai-search/',
      content_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  },
  score: 0.82,
};

test('parseCompletionSseFrame reads event: chunks with array payload', () => {
  const frame = `event: chunks\r\ndata: ${JSON.stringify([item])}`;
  assert.deepEqual(parseCompletionSseFrame(frame), {kind: 'chunks', chunks: [item]});
});

test('parseCompletionSseFrame ignores legacy data.event shape', () => {
  const frame = `data: ${JSON.stringify({event: 'chunks', chunks: [item]})}`;
  const parsed = parseCompletionSseFrame(frame);
  assert.equal(parsed?.kind, 'message');
  assert.equal(parsed?.data?.event, 'chunks');
});

test('consumeCompletionSseBuffer handles split frames and CRLF keepalives', () => {
  const completion = {model: '@cf/zai-org/glm-5.3', choices: [{delta: {content: '回答'}, finish_reason: null}]};
  const raw = `: keepalive\r\n\r\nevent: chunks\r\ndata: ${JSON.stringify([item])}\r\n\r\ndata: ${JSON.stringify(completion)}\r\n\r\ndata: [DONE]\r\n\r\n`;
  const sources = [];
  let model;
  let answer = '';
  let done = false;
  let buffer = '';
  for (let offset = 0; offset < raw.length; offset += 7) {
    buffer = consumeCompletionSseBuffer(buffer + raw.slice(offset, offset + 7), frame => {
      if (frame.kind === 'chunks') sources.push(...mapChunkSources(frame.chunks));
      if (frame.kind === 'message') {
        if (frame.data.model) model = frame.data.model;
        answer += frame.data.choices?.[0]?.delta?.content ?? '';
      }
      if (frame.kind === 'done') done = true;
    });
  }
  assert.equal(sources.length, 1);
  assert.equal(sources[0].score, 0.82);
  assert.equal(model, '@cf/zai-org/glm-5.3');
  assert.equal(answer, '回答');
  assert.equal(done, true);
  assert.equal(buffer, '');
});
