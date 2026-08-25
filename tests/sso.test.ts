import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeUrl, challengeS256, exchangeCode, generateVerifier, refreshToken, validateJwt, type PostForm } from '../src/data/sso.js';

test('PKCE: RFC 7636 appendix-B vector reproduces exactly', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(await challengeS256(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('verifier: 43-char base64url from 32 random bytes; unreserved alphabet only', () => {
  const v = generateVerifier();
  assert.equal(v.length, 43);
  assert.match(v, /^[A-Za-z0-9_-]+$/);
  const fixed = generateVerifier((n) => new Uint8Array(n)); // all zeros
  assert.equal(fixed, 'A'.repeat(43));
});

test('authorize URL carries every PKCE parameter and rejects weak state', async () => {
  const url = new URL(authorizeUrl({
    clientId: 'abc123', redirectUri: 'https://v9.example/callback',
    scopes: ['esi-planets.manage_planets.v1'], state: 'sturdy-random-state',
    challenge: await challengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
  }));
  assert.equal(url.origin + url.pathname, 'https://login.eveonline.com/v2/oauth/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(url.searchParams.get('scope'), 'esi-planets.manage_planets.v1');
  assert.throws(() => authorizeUrl({ clientId: 'x', redirectUri: 'y', scopes: [], state: 'abc', challenge: 'c' }), /sso-state-too-short/);
});

test('token exchange posts the PKCE form with NO secret; failures surface the SSO error', async () => {
  const calls: Array<{ url: string; form: Record<string, string> }> = [];
  const post: PostForm = async (url, form) => {
    calls.push({ url, form: { ...form } });
    return { status: 200, body: { access_token: 'AT', refresh_token: 'RT-rotated', expires_in: 1199, token_type: 'Bearer' } };
  };
  const t = await exchangeCode(post, { clientId: 'abc123', code: 'CODE', verifier: 'VERIFIER' });
  assert.equal(t.refresh_token, 'RT-rotated'); // caller must persist THIS one
  assert.equal(calls[0]!.url, 'https://login.eveonline.com/v2/oauth/token');
  assert.deepEqual(calls[0]!.form, { grant_type: 'authorization_code', code: 'CODE', client_id: 'abc123', code_verifier: 'VERIFIER' });
  assert.ok(!('client_secret' in calls[0]!.form));

  const proxied = await refreshToken(async (url, form) => {
    calls.push({ url, form: { ...form } });
    return { status: 200, body: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 1199, token_type: 'Bearer' } };
  }, { clientId: 'abc123', refreshToken: 'RT-rotated', tokenBase: 'https://worker.example' });
  assert.equal(proxied.access_token, 'AT2');
  assert.equal(calls[1]!.url, 'https://worker.example/v2/oauth/token'); // the Worker insurance path

  await assert.rejects(
    exchangeCode(async () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'expired code' } }), { clientId: 'x', code: 'c', verifier: 'v' }),
    /sso-token-failed: HTTP 400 invalid_grant expired code/,
  );
});

// Full signed-JWT round trip with a locally generated RS256 key.
async function makeJwt(claims: Record<string, unknown>, kid = 'test-key'): Promise<{ token: string; jwk: import('../src/data/sso.js').Jwk }> {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']);
  const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: 'RS256', typ: 'JWT', kid });
  const body = enc(claims);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`)));
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Record<string, unknown>;
  jwk['kid'] = kid;
  return { token: `${head}.${body}.${b64url(sig)}`, jwk: jwk as import('../src/data/sso.js').Jwk };
}

const goodClaims = {
  iss: 'https://login.eveonline.com',
  aud: ['abc123', 'EVE Online'],
  exp: 2_000_000_000,
  sub: 'CHARACTER:EVE:95465499',
  name: 'Test Pilot',
  owner: 'ownerhash==',
  scp: 'esi-planets.manage_planets.v1',
};

test('JWT validation: a properly signed token yields character identity', async () => {
  const { token, jwk } = await makeJwt(goodClaims);
  const v = await validateJwt(token, { jwks: [jwk], clientId: 'abc123', nowEpochS: 1_900_000_000 });
  assert.equal(v.characterId, 95465499);
  assert.equal(v.characterName, 'Test Pilot');
  assert.deepEqual(v.scopes, ['esi-planets.manage_planets.v1']);
  assert.equal(v.owner, 'ownerhash==');
});

test('JWT validation rejects, BY NAME: bad signature, wrong issuer, wrong audience, expiry', async () => {
  const { token, jwk } = await makeJwt(goodClaims);
  const { jwk: otherKey } = await makeJwt(goodClaims, 'other');
  await assert.rejects(validateJwt(token, { jwks: [{ ...otherKey, kid: 'test-key' }], clientId: 'abc123', nowEpochS: 1_900_000_000 }), /jwt-signature-invalid/);

  const wrongIss = await makeJwt({ ...goodClaims, iss: 'https://evil.example' });
  await assert.rejects(validateJwt(wrongIss.token, { jwks: [wrongIss.jwk], clientId: 'abc123', nowEpochS: 1_900_000_000 }), /jwt-issuer-invalid/);

  const wrongAud = await makeJwt({ ...goodClaims, aud: ['someone-else', 'EVE Online'] });
  await assert.rejects(validateJwt(wrongAud.token, { jwks: [wrongAud.jwk], clientId: 'abc123', nowEpochS: 1_900_000_000 }), /jwt-audience-invalid/);

  await assert.rejects(validateJwt(token, { jwks: [jwk], clientId: 'abc123', nowEpochS: 2_100_000_000 }), /jwt-expired/);

  const badSub = await makeJwt({ ...goodClaims, sub: 'not-a-character' });
  await assert.rejects(validateJwt(badSub.token, { jwks: [badSub.jwk], clientId: 'abc123', nowEpochS: 1_900_000_000 }), /jwt-subject-invalid/);
});
