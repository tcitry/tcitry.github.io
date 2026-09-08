import assert from 'node:assert/strict';
import test from 'node:test';
import {clerkIssuerFromPublishableKey, normalizeClerkIssuer} from '../scripts/lib/clerk-issuer.mjs';

test('Clerk issuer helpers accept Frontend API URLs and publishable keys', () => {
  const encoded = Buffer.from('clerk.test.invalid$').toString('base64');
  assert.equal(clerkIssuerFromPublishableKey(`pk_test_${encoded}`), 'https://clerk.test.invalid');
  assert.equal(clerkIssuerFromPublishableKey(`pk_live_${encoded}`), 'https://clerk.test.invalid');
  assert.equal(clerkIssuerFromPublishableKey('pk_test_not-valid'), '');
  assert.equal(normalizeClerkIssuer('https://clerk.test.invalid/'), 'https://clerk.test.invalid');
  assert.equal(normalizeClerkIssuer('http://clerk.test.invalid'), '');
});
