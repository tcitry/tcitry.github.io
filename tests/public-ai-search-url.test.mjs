import assert from 'node:assert/strict';
import test from 'node:test';
import {publicAIEndpoint} from '../src/lib/public-ai-search-url.mjs';

test('configured custom and default domains share literal search/chat URL normalization', () => {
  for (const host of ['search.example.com', 'search-v2.example.org', 'fixture.search.ai.cloudflare.com']) {
    for (const path of ['', '/', '/search', '/search/']) {
      assert.equal(publicAIEndpoint(`https://${host}${path}`), `https://${host}/search`);
    }
    for (const path of ['', '/', '/search', '/search/', '/chat/completions', '/chat/completions/']) {
      assert.equal(publicAIEndpoint(`https://${host}${path}`, {endpoint: 'chat/completions', allowChatPath: true}), `https://${host}/chat/completions`);
    }
    assert.throws(() => publicAIEndpoint(`https://${host}/chat/completions`));
  }
  assert.equal(publicAIEndpoint('https://SEARCH.example.com'), 'https://search.example.com/search');
});

test('custom domains never permit credentials, IPs, local names, ports or normalized unsafe paths', () => {
  const origin = 'https://search.example.com';
  for (const input of [undefined, null, '', ' ',
    'http://search.example.com/search', '//search.example.com/search',
    'https://user:fixture-private-value@search.example.com/search',
    'https://localhost/search', 'https://api.localhost/search', 'https://api.local/search',
    'https://metadata.google.internal/search', 'https://search.lan/search',
    'https://127.0.0.1/search', 'https://10.0.0.1/search', 'https://169.254.169.254/search',
    'https://2130706433/search', 'https://0x7f000001/search', 'https://127.1/search',
    'https://[::1]/search', 'https://[2001:db8::1]/search',
    'https://-search.example.com/search', 'https://search-.example.com/search',
    'https://search..example.com/search', 'https://search.example.com./search',
    'https://search.ai.cloudflare.com/search', 'https://nested.fixture.search.ai.cloudflare.com/search',
    'https://search.example.com:443/search', 'https://search.example.com:8443/search',
    'https://%73earch.example.com/search', origin + '/other/../search', origin + '/%73earch',
    origin + '/v1/search', origin + '/search?', origin + '/search#',
    origin + '/search?token=fixture-private-value', origin + '/search#fixture-private-value',
    origin + '\\search', origin + '/search\n', origin + '/search\t', ' ' + origin,
  ]) {
    assert.throws(() => publicAIEndpoint(input, {allowChatPath: true}), error => {
      assert.equal(error.message, 'AI Search endpoint is invalid.');
      return true;
    });
  }
});
