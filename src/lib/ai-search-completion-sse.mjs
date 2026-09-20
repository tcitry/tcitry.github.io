/** Map AI Search chat/completions chunk events to eval-friendly source rows. */
export function mapChunkSources(chunks) {
  if (!Array.isArray(chunks)) return [];
  return chunks.map(chunk => ({
    key: chunk?.item?.key,
    score: chunk?.score,
    title: chunk?.item?.metadata?.canonical_url,
    hash: chunk?.item?.metadata?.content_hash,
  }));
}

/**
 * Parse one SSE frame from AI Search /chat/completions.
 * Mirrors convex/assistantModel.verifiedCompletionStream event handling.
 */
export function parseCompletionSseFrame(frame) {
  let event = '';
  const data = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (!data.length) return null;
  const payload = data.join('\n');
  if (event === 'chunks') {
    try {
      return {kind: 'chunks', chunks: JSON.parse(payload)};
    } catch {
      return {kind: 'error', error: 'invalid chunks payload'};
    }
  }
  if (payload === '[DONE]') return {kind: 'done'};
  try {
    return {kind: 'message', data: JSON.parse(payload)};
  } catch {
    return null;
  }
}

/** Incrementally consume buffered SSE bytes from a completion stream. */
export function consumeCompletionSseBuffer(buffer, onFrame) {
  let remaining = buffer;
  let boundary;
  while ((boundary = /\r?\n\r?\n/.exec(remaining))) {
    const frame = remaining.slice(0, boundary.index);
    remaining = remaining.slice(boundary.index + boundary[0].length);
    const parsed = parseCompletionSseFrame(frame);
    if (parsed) onFrame(parsed);
  }
  return remaining;
}
