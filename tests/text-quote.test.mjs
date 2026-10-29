import assert from 'node:assert/strict';
import test from 'node:test';
import {locateQuote} from '../src/scripts/text-quote.mjs';

const text = 'alpha beta alpha beta end';

test('prefix and suffix pick the later copy of the same quote', () => {
  assert.deepEqual(locateQuote(text, 'alpha', '', ''), {start: 0, end: 5});
  assert.deepEqual(locateQuote(text, 'alpha', 'beta ', ' beta'), {start: 11, end: 16});
  assert.equal(locateQuote(text, 'missing', 'beta ', ''), null);
  assert.equal(locateQuote('', 'alpha'), null);
});

test('collapsed whitespace still locates the quote', () => {
  const located = locateQuote('hello   world  today', 'hello world', '', ' today');
  assert.ok(located);
  assert.equal('hello   world  today'.slice(located.start, located.end), 'hello   world');
});
