import {exportSPKI, generateKeyPair, SignJWT} from 'jose';

const ISSUER = 'https://clerk.test.invalid';

export async function createChatClerk() {
  const {privateKey, publicKey} = await generateKeyPair('RS256');
  const env = {
    CLERK_JWT_ISSUER: ISSUER,
    CLERK_JWT_KEY: await exportSPKI(publicKey),
  };
  async function token(claims = {}) {
    return new SignJWT({azp: 'https://yindongliang.com', sub: 'user_test', ...claims})
      .setProtectedHeader({alg: 'RS256'})
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  }
  return {
    env,
    issuer: ISSUER,
    async headers(claims) {
      return {authorization: `Bearer ${await token(claims)}`};
    },
  };
}
