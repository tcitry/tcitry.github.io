const LOCAL_SUFFIXES = new Set(['localhost', 'local', 'internal', 'lan', 'home', 'invalid', 'test', 'example', 'onion', 'arpa']);
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ERROR = 'AI Search endpoint is invalid.';

/**
 * Validate an operator-configured public endpoint, including a custom domain.
 * This is configuration validation, not proof of DNS ownership. Callers must
 * never accept the endpoint from an untrusted request and must refuse redirects.
 *
 * @param {unknown} value
 * @param {{endpoint?: 'search' | 'chat/completions', allowChatPath?: boolean}} options
 * @returns {string}
 */
export function publicAIEndpoint(value, {endpoint = 'search', allowChatPath = false} = {}) {
  if (!['search', 'chat/completions'].includes(endpoint)) throw new Error(ERROR);
  if (typeof value !== 'string' || /[\\\s\u0000-\u001f\u007f]/u.test(value)) throw new Error(ERROR);
  // Check the literal spelling first: URL would otherwise normalize traversal,
  // default ports, whitespace and encoded hostnames into apparently safe URLs.
  const match = /^https:\/\/([A-Za-z0-9.-]+)(\/(?:search\/?|chat\/completions\/?)?)?$/.exec(value);
  if (!match) throw new Error(ERROR);
  let url;
  try { url = new URL(value); } catch { throw new Error(ERROR); }
  const host = url.hostname;
  const labels = host.split('.');
  const suffix = labels.at(-1) ?? '';
  if (host !== match[1].toLowerCase() || host.length > 253 || labels.length < 2
      || labels.some(label => !LABEL.test(label)) || !/[a-z]/.test(suffix)
      || LOCAL_SUFFIXES.has(suffix) || host === 'search.ai.cloudflare.com'
      || (host.endsWith('.search.ai.cloudflare.com') && labels.length !== 5)
      || (!allowChatPath && !['/', '/search', '/search/'].includes(url.pathname))) throw new Error(ERROR);
  url.pathname = `/${endpoint}`;
  return url.href;
}
