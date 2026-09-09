const OBVIOUS_BOT = /bot\b|crawler|spider|slurp|facebookexternalhit|whatsapp|telegrambot|discordbot|slackbot|linkedinbot|twitterbot|applebot|bingbot|googlebot|lighthouse|pagespeed|pingdom|statuscake|uptimerobot|headless|wget\/|curl\/|python-requests|go-http-client|httpclient|scrapy|health.?check/i;

export function visitSecrets(env = {}) {
  const url = String(env.VISIT_WEBHOOK_URL ?? '').trim();
  const authorization = String(env.VISIT_WEBHOOK_AUTHORIZATION ?? '').trim();
  if (!url || !authorization) return null;
  try {
    if (new URL(url).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { url, authorization };
}

export function shouldNotifyVisit(request) {
  if (request.method !== 'GET') return false;
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith('/cdn-cgi') || pathname.startsWith('/pagefind/') || pathname.startsWith('/_astro/')) return false;
  if (/^\/(?:healthz?|readyz?|livez|ping)\/?$/i.test(pathname)) return false;
  const filename = pathname.split('/').pop() || '';
  if (filename.includes('.') && !/\.html?$/i.test(filename)) return false;

  const purpose = request.headers.get('purpose')
    || request.headers.get('sec-purpose')
    || request.headers.get('sec-fetch-purpose')
    || '';
  if (/prefetch|prerender/i.test(purpose) || request.headers.get('x-moz') === 'prefetch') return false;

  const mode = request.headers.get('sec-fetch-mode');
  if (mode && mode !== 'navigate') return false;
  const dest = request.headers.get('sec-fetch-dest');
  if (dest && dest !== 'document') return false;

  const accept = request.headers.get('accept');
  if (accept && !/\btext\/html\b/i.test(accept) && !/\*\/\*/.test(accept)) return false;

  const userAgent = request.headers.get('user-agent') || '';
  if (!userAgent || OBVIOUS_BOT.test(userAgent)) return false;
  return true;
}

export function visitPayload(request, now = new Date()) {
  const payload = { path: new URL(request.url).pathname, timestamp: now.toISOString() };
  const referrer = request.headers.get('referer')?.trim();
  if (referrer) payload.referrer = referrer;
  return payload;
}

export async function postVisit(secrets, payload, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(secrets.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: secrets.authorization,
    },
    body: JSON.stringify(payload),
  });
  if (typeof response?.ok === 'boolean' && !response.ok) throw new Error('Visit webhook failed');
}

export function notifyPageView(request, env, ctx, assetResponse, fetchImpl = globalThis.fetch) {
  if (!visitSecrets(env) || !shouldNotifyVisit(request)) return false;
  ctx.waitUntil(sendHtmlVisit(assetResponse, request, env, fetchImpl));
  return true;
}

async function sendHtmlVisit(assetResponse, request, env, fetchImpl) {
  try {
    const secrets = visitSecrets(env);
    if (!secrets) return;
    const response = await assetResponse;
    if (response.status < 200 || response.status >= 300) return;
    if (!/\btext\/html\b/i.test(response.headers.get('content-type') || '')) return;
    await postVisit(secrets, visitPayload(request), fetchImpl);
  } catch {
    // A failed notify must never delay or break the static page.
  }
}
