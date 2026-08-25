/**
 * EVE SSO for a browser tool: OAuth2 authorization-code + PKCE (public
 * client, no secret). Endpoints and rules per library 17 (CCP docs):
 *   authorize: https://login.eveonline.com/v2/oauth/authorize
 *   token:     https://login.eveonline.com/v2/oauth/token
 * Access tokens ~20 min; refresh tokens rotate — ALWAYS store the returned
 * one. JWT validation: JWKS signature + issuer + audience (client_id AND
 * "EVE Online").
 *
 * Crypto via WebCrypto (browser and Node ≥19), transport injected for
 * offline tests. Token calls can be routed through a proxy base URL (the
 * ~50-line Cloudflare Worker insurance policy) by changing `tokenBase`.
 */

export const SSO_AUTHORIZE = 'https://login.eveonline.com/v2/oauth/authorize';
export const SSO_TOKEN_PATH = '/v2/oauth/token';
export const SSO_DEFAULT_TOKEN_BASE = 'https://login.eveonline.com';
export const SSO_ISSUERS = ['https://login.eveonline.com', 'login.eveonline.com'] as const;
export const PLANETS_SCOPE = 'esi-planets.manage_planets.v1';

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** RFC 7636: 32 random bytes, base64url — 43 chars, unreserved alphabet. */
export function generateVerifier(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return b64url(random(32));
}

export async function challengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export interface AuthorizeParams {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: ReadonlyArray<string>;
  readonly state: string;
  readonly challenge: string; // from challengeS256(verifier)
}

export function authorizeUrl(p: AuthorizeParams): string {
  if (p.state.length < 8) throw new Error('sso-state-too-short: use >= 8 random chars');
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: p.scopes.join(' '),
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  });
  return `${SSO_AUTHORIZE}?${q.toString()}`;
}

export interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly token_type: string;
}

export type PostForm = (url: string, form: Readonly<Record<string, string>>) => Promise<{ status: number; body: unknown }>;

async function tokenCall(post: PostForm, tokenBase: string, form: Record<string, string>): Promise<TokenResponse> {
  const { status, body } = await post(`${tokenBase}${SSO_TOKEN_PATH}`, form);
  if (status !== 200) {
    const err = (body as { error?: string; error_description?: string }) ?? {};
    throw new Error(`sso-token-failed: HTTP ${status} ${err.error ?? ''} ${err.error_description ?? ''}`.trim());
  }
  const t = body as TokenResponse;
  if (typeof t.access_token !== 'string' || typeof t.refresh_token !== 'string')
    throw new Error('sso-token-malformed: missing access_token/refresh_token');
  return t;
}

export function exchangeCode(post: PostForm, args: { clientId: string; code: string; verifier: string; tokenBase?: string }): Promise<TokenResponse> {
  return tokenCall(post, args.tokenBase ?? SSO_DEFAULT_TOKEN_BASE, {
    grant_type: 'authorization_code',
    code: args.code,
    client_id: args.clientId,
    code_verifier: args.verifier,
  });
}

/** Refresh rotates: the CALLER MUST persist the returned refresh_token. */
export function refreshToken(post: PostForm, args: { clientId: string; refreshToken: string; tokenBase?: string }): Promise<TokenResponse> {
  return tokenCall(post, args.tokenBase ?? SSO_DEFAULT_TOKEN_BASE, {
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  });
}

// ---------------------------------------------------------------------------
// JWT validation (RS256 against the SSO JWKS)
// ---------------------------------------------------------------------------

export interface Jwk { readonly kid?: string; readonly kty?: string; readonly [k: string]: unknown }

export interface ValidatedToken {
  readonly characterId: number;
  readonly characterName: string;
  readonly scopes: ReadonlyArray<string>;
  readonly owner: string; // changes when the character changes account — force re-auth on change
  readonly expiresAt: number; // epoch seconds
}

export async function validateJwt(
  token: string,
  args: { jwks: ReadonlyArray<Jwk>; clientId: string; nowEpochS: number },
): Promise<ValidatedToken> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('jwt-malformed: expected three segments');
  const [h, p, sig] = parts as [string, string, string];
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h))) as { alg: string; kid?: string };
  if (header.alg !== 'RS256') throw new Error(`jwt-alg-unsupported: ${header.alg}`);
  const jwk = args.jwks.find((k) => k.kid === header.kid) ?? args.jwks[0];
  if (jwk === undefined) throw new Error('jwt-no-jwks-key');
  const key = await crypto.subtle.importKey('jwk', jwk as JsonWebKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(sig).slice().buffer as ArrayBuffer, new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('jwt-signature-invalid');

  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as {
    iss: string; aud: string | string[]; exp: number; sub: string; name: string; owner: string; scp: string | string[];
  };
  if (!SSO_ISSUERS.includes(claims.iss as (typeof SSO_ISSUERS)[number]))
    throw new Error(`jwt-issuer-invalid: ${claims.iss}`);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(args.clientId) || !aud.includes('EVE Online'))
    throw new Error(`jwt-audience-invalid: ${aud.join(', ')}`);
  if (claims.exp <= args.nowEpochS) throw new Error('jwt-expired');
  const m = /^CHARACTER:EVE:(\d+)$/.exec(claims.sub);
  if (m === null) throw new Error(`jwt-subject-invalid: ${claims.sub}`);
  return {
    characterId: Number(m[1]),
    characterName: claims.name,
    scopes: Array.isArray(claims.scp) ? claims.scp : [claims.scp],
    owner: claims.owner,
    expiresAt: claims.exp,
  };
}
