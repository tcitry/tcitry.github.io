import {describe, expect, test} from 'vitest';
import type {LanguageModelV4, LanguageModelV4StreamPart} from '@ai-sdk/provider';
import {gatewayModel, parseRetrieval, retrievalEndpoint, SAFE_ERROR, visibleTextFilter} from './assistantModel';
import {safeModelMiddleware} from './assistantModel';

const model = {} as LanguageModelV4;
async function wrapped(stream: ReadableStream<LanguageModelV4StreamPart>) {
  return safeModelMiddleware(async () => {}).wrapStream!({model, params: {prompt: []}, doGenerate: async () => {throw new Error('unused');}, doStream: async () => ({stream})});
}
async function read(stream: ReadableStream<LanguageModelV4StreamPart>) {
  const reader = stream.getReader();
  const result = [];
  while (true) { const item = await reader.read(); if (item.done) break; result.push(item.value); }
  return result;
}

describe('assistant model boundary', () => {
  test('strips split and unclosed think blocks before storage', () => {
    const filter = visibleTextFilter();
    expect(filter('你好<th')).toBe('你好'); expect(filter('ink>private')).toBe('');
    expect(filter('</thi')).toBe(''); expect(filter('nk>公开')).toBe('公开');
    expect(filter('<think>private', true)).toBe('');
  });
  test('underlying asynchronous stream rejection is sanitized', async () => {
    const stream = new ReadableStream<LanguageModelV4StreamPart>({start(controller) {controller.error(new Error('provider raw body marker test-only-token'));}});
    const result = await wrapped(stream);
    await expect(read(result.stream)).rejects.toThrow(SAFE_ERROR);
    await expect(read((await wrapped(new ReadableStream({start(controller) {controller.close();}}))).stream)).rejects.toThrow(SAFE_ERROR);
  });
  test('blocks non-server retrieval routes and malformed citations', () => {
    expect(retrievalEndpoint('http://localhost:4321/api/internal/retrieve')).toContain('localhost');
    for (const url of ['http://example.test/api/internal/retrieve', 'https://user:pass@example.test/api/internal/retrieve', 'https://example.test/other', 'https://example.test/api/internal/retrieve?token=secret']) expect(() => retrievalEndpoint(url)).toThrow();
    expect(() => parseRetrieval({sources: [{id: '1', title: 'x', url: 'https://attacker.test/', sourceKind: 'author'}], snippets: []})).toThrow();
    expect(parseRetrieval({sources: [], snippets: []})).toEqual({sources: [], snippets: []});
  });
  test('model uses the current provider protocol with a fixed model identity', () => {
    const model = gatewayModel('a'.repeat(32), 'test-only-token', async () => {});
    expect(model.modelId).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(model.specificationVersion).toBe('v4');
  });
});
