function decodeIssuerPayload(encoded) {
  const padded = encoded + '='.repeat((4 - (encoded.length % 4)) % 4);
  try {
    const payload = atob(padded);
    if (!payload.endsWith('$') || btoa(payload).replace(/=+$/, '') !== encoded.replace(/=+$/, '')) return '';
    return payload;
  } catch {
    return '';
  }
}

export function clerkIssuerFromPublishableKey(key) {
  const match = /^(?:pk_(?:test|live)_)([A-Za-z0-9+/_=-]+)$/.exec(key ?? '');
  if (!match) return '';
  const encoded = match[1].replaceAll('-', '+').replaceAll('_', '/');
  const payload = decodeIssuerPayload(encoded);
  if (!payload) return '';
  try {
    const issuer = new URL(`https://${payload.slice(0, -1).toLowerCase()}`);
    if (issuer.username || issuer.search || issuer.hash || issuer.pathname !== '/') return '';
    return issuer.origin;
  } catch {
    return '';
  }
}

export function normalizeClerkIssuer(value) {
  if (typeof value !== 'string') return '';
  try {
    const issuer = new URL(value.trim());
    if (issuer.protocol !== 'https:' || issuer.username || issuer.search || issuer.hash || issuer.pathname !== '/') return '';
    return issuer.origin;
  } catch {
    return '';
  }
}
