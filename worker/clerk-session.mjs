import {createRemoteJWKSet, importSPKI, jwtVerify} from 'jose';
import {clerkIssuerFromPublishableKey, normalizeClerkIssuer} from '../scripts/lib/clerk-issuer.mjs';

const jwksByIssuer = new Map();

function bearerToken(request) {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '');
  return match?.[1] ?? '';
}

async function verifyMaterial(env, issuer) {
  const pem = typeof env.CLERK_JWT_KEY === 'string' ? env.CLERK_JWT_KEY.trim() : '';
  if (pem) return importSPKI(pem, 'RS256');
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksByIssuer.set(issuer, jwks);
  }
  return jwks;
}

export async function verifyChatSession(request, env) {
  const issuer = normalizeClerkIssuer(env?.CLERK_JWT_ISSUER)
    || clerkIssuerFromPublishableKey(env?.PUBLIC_CLERK_PUBLISHABLE_KEY);
  if (!issuer) return {status: 503, message: '博客助手尚未完成连接，请稍后再来。'};
  const token = bearerToken(request);
  if (!token) return {status: 401, message: '请先登录后再提问。'};
  const origin = request.headers.get('origin') || new URL(request.url).origin;
  try {
    const {payload} = await jwtVerify(token, await verifyMaterial(env, issuer), {
      issuer, algorithms: ['RS256'], clockTolerance: 5, requiredClaims: ['exp'],
    });
    // Clerk's Convex integration adds this audience to the default v2 session
    // token. A template token without session claims is still not accepted.
    if (payload.aud !== undefined && (
      payload.aud !== 'convex' || payload.v !== 2
      || typeof payload.sid !== 'string' || !payload.sid.trim()
    )) throw new Error('aud');
    if (payload.sts === 'pending') throw new Error('rejected');
    if (payload.azp && payload.azp !== origin) throw new Error('azp');
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('sub');
    return {userId: payload.sub};
  } catch {
    return {status: 401, message: '登录已过期，请重新登录后提问。'};
  }
}
