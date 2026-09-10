import assert from 'node:assert/strict';
import test from 'node:test';
import {exportSPKI, generateKeyPair, SignJWT} from 'jose';
import {verifyChatSession} from '../worker/clerk-session.mjs';

const issuer = 'https://clerk.test.invalid';
const origin = 'https://yindongliang.com';
const {privateKey, publicKey} = await generateKeyPair('RS256');
const env = {CLERK_JWT_ISSUER: issuer, CLERK_JWT_KEY: await exportSPKI(publicKey)};

async function verify(claims = {}, {key = privateKey, algorithm = 'RS256'} = {}) {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    iss: issuer, sub: 'user_test', sid: 'sess_test', v: 2,
    azp: origin, iat: now, nbf: now, exp: now + 60, ...claims,
  }).setProtectedHeader({alg: algorithm}).sign(key);
  return verifyChatSession(new Request(`${origin}/api/chat`, {
    headers: {origin, authorization: `Bearer ${token}`},
  }), env);
}

test('Clerk session verification supports sessions with and without the Convex audience', async () => {
  for (const claims of [{}, {v: undefined}, {aud: 'convex'}, {aud: 'convex', sts: 'active'}]) {
    assert.deepEqual(await verify(claims), {userId: 'user_test'});
  }
});

test('Clerk session verification rejects template tokens, foreign audiences and pending sessions', async () => {
  const invalid = [
    {aud: 'convex', v: undefined, sid: undefined},
    {aud: 'convex', v: undefined},
    {aud: 'convex', v: '2'},
    {aud: 'convex', sid: undefined},
    {aud: 'convex', sid: ''},
    {aud: 'convex', sid: ' '},
    {aud: 'other'},
    {aud: ['convex', 'other']},
    {aud: null},
    {aud: 'convex', sts: 'pending'},
    {sts: 'pending'},
  ];
  for (const claims of invalid) assert.equal((await verify(claims)).status, 401, JSON.stringify(claims));
});

test('Clerk integration sessions still require issuer, expiration, authorized party and subject', async () => {
  const invalid = [
    {iss: 'https://foreign.test.invalid'},
    {iss: undefined},
    {exp: Math.floor(Date.now() / 1000) - 60},
    {exp: undefined},
    {nbf: Math.floor(Date.now() / 1000) + 60},
    {azp: 'https://foreign.test.invalid'},
    {sub: ''},
    {sub: undefined},
  ];
  for (const claims of invalid) {
    assert.equal((await verify({aud: 'convex', ...claims})).status, 401, JSON.stringify(claims));
  }
});

test('Clerk integration sessions require a trusted RS256 signature', async () => {
  const wrongSigner = await generateKeyPair('RS256');
  assert.equal((await verify({aud: 'convex'}, {key: wrongSigner.privateKey})).status, 401);
  const hmacKey = new TextEncoder().encode('synthetic-session-test-key-with-at-least-32-bytes');
  assert.equal((await verify({aud: 'convex'}, {key: hmacKey, algorithm: 'HS256'})).status, 401);
});
