import { describe, expect, it, vi } from 'vitest';
import type { CredentialVaultPort } from '../../../src/application/ports/CredentialVaultPort';
import {
  LINKEDIN_AUTHORIZATION_ENDPOINT,
  LINKEDIN_SCOPES,
  LINKEDIN_TOKEN_CREDENTIAL_ID,
  LINKEDIN_TOKEN_ENDPOINT,
  LINKEDIN_USERINFO_ENDPOINT,
  LinkedInOAuthService,
} from '../../../src/application/linkedin/connection';

class MemoryVault implements CredentialVaultPort {
  value: string | null = null;
  readonly set = vi.fn(async (_id: string, value: string) => { this.value = value; });
  readonly get = vi.fn(async () => this.value);
  readonly delete = vi.fn(async () => { this.value = null; });
}

const configuration = { clientId: 'public-client-id', apiVersion: '202608' };

describe('LinkedInOAuthService', () => {
  it('rejects a concurrent connect attempt while preserving the original lifecycle', async () => {
    const vault = new MemoryVault();
    let releaseAuthorization!: () => void;
    const authorizationReady = new Promise<void>((resolve) => { releaseAuthorization = resolve; });
    let authorizationUrl = '';
    const loopback = {
      authorize: vi.fn(async (createUrl: (redirectUri: string) => string) => {
        authorizationUrl = createUrl('http://127.0.0.1:43123/callback');
        await authorizationReady;
        return {
          code: 'authorization-code',
          state: new URL(authorizationUrl).searchParams.get('state')!,
          redirectUri: 'http://127.0.0.1:43123/callback',
        };
      }),
    };
    const http = { fetch: vi.fn(async (url: string) => url === LINKEDIN_TOKEN_ENDPOINT
      ? new Response(JSON.stringify({
          access_token: 'access-token', expires_in: 3600, scope: LINKEDIN_SCOPES.join(' '),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify({ sub: 'abc' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })) };
    const service = new LinkedInOAuthService(vault, loopback, {
      randomUrlSafe: (size) => Buffer.alloc(size, size).toString('base64url'),
      sha256UrlSafe: () => 'challenge',
    }, http);

    const first = service.connect(configuration, new AbortController().signal);
    await expect(service.connect(configuration, new AbortController().signal))
      .rejects.toThrow('already in progress');
    expect(await service.status(configuration)).toEqual({ state: 'connecting' });
    releaseAuthorization();
    await expect(first).resolves.toMatchObject({ state: 'connected' });
    expect(loopback.authorize).toHaveBeenCalledTimes(1);
  });

  it('disconnects an in-flight connect and cannot restore a credential after a delayed vault write', async () => {
    let stored: string | null = null;
    let releaseWrite!: () => void;
    const mayFinishWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
    let writeStarted!: () => void;
    const didStartWrite = new Promise<void>((resolve) => { writeStarted = resolve; });
    const vault: CredentialVaultPort = {
      async get() { return stored; },
      async set(_id, value) {
        writeStarted();
        await mayFinishWrite;
        stored = value;
      },
      async delete() { stored = null; },
    };
    let authorizationUrl = '';
    const service = new LinkedInOAuthService(vault, {
      authorize: vi.fn(async (createUrl: (redirectUri: string) => string) => {
        authorizationUrl = createUrl('http://127.0.0.1:43123/callback');
        return {
          code: 'authorization-code',
          state: new URL(authorizationUrl).searchParams.get('state')!,
          redirectUri: 'http://127.0.0.1:43123/callback',
        };
      }),
    }, {
      randomUrlSafe: (size) => Buffer.alloc(size, size).toString('base64url'),
      sha256UrlSafe: () => 'challenge',
    }, { fetch: vi.fn(async (url: string) => url === LINKEDIN_TOKEN_ENDPOINT
      ? new Response(JSON.stringify({
          access_token: 'access-token', expires_in: 3600, scope: LINKEDIN_SCOPES.join(' '),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify({ sub: 'abc' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })) });

    const connect = service.connect(configuration, new AbortController().signal);
    await didStartWrite;
    const disconnect = service.disconnect();
    releaseWrite();

    await expect(connect).rejects.toThrow();
    await expect(disconnect).resolves.toEqual({ state: 'disconnected' });
    expect(stored).toBeNull();
    expect(await service.status(configuration)).toEqual({ state: 'disconnected' });
  });

  it('uses Authorization Code with PKCE, validates state, resolves OIDC identity, and vaults the token', async () => {
    const vault = new MemoryVault();
    let authorizationUrl = '';
    const loopback = {
      authorize: vi.fn(async (createUrl: (redirectUri: string) => string) => {
        authorizationUrl = createUrl('http://127.0.0.1:43123/callback');
        return {
          code: 'authorization-code',
          state: new URL(authorizationUrl).searchParams.get('state')!,
          redirectUri: 'http://127.0.0.1:43123/callback',
        };
      }),
    };
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const http = { fetch: vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url === LINKEDIN_TOKEN_ENDPOINT) return new Response(JSON.stringify({
        access_token: 'top-secret-access-token', expires_in: 3600, scope: LINKEDIN_SCOPES.join(' '),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url === LINKEDIN_USERINFO_ENDPOINT) return new Response(JSON.stringify({ sub: 'abc_123', name: 'Ada Member' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
      throw new Error('Unexpected URL');
    }) };
    const service = new LinkedInOAuthService(
      vault, loopback, {
        randomUrlSafe: (size) => Buffer.alloc(size, size).toString('base64url'),
        sha256UrlSafe: (value) => `challenge-${value.length}`,
      }, http, () => new Date('2026-09-11T10:00:00.000Z'),
    );

    const result = await service.connect(configuration, new AbortController().signal);

    const authorization = new URL(authorizationUrl);
    expect(`${authorization.origin}${authorization.pathname}`).toBe(LINKEDIN_AUTHORIZATION_ENDPOINT);
    expect(authorization.searchParams.get('scope')).toBe('openid profile w_member_social');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorization.searchParams.get('client_id')).toBe(configuration.clientId);
    const tokenBody = String(requests[0]?.init.body);
    expect(tokenBody).toContain('code_verifier=');
    expect(tokenBody).not.toContain('client_secret');
    expect(requests[1]?.init.headers).toEqual({ Authorization: 'Bearer top-secret-access-token' });
    expect(result).toMatchObject({ state: 'connected', member: { subject: 'abc_123', authorUrn: 'urn:li:person:abc_123' } });
    expect(vault.set).toHaveBeenCalledWith(LINKEDIN_TOKEN_CREDENTIAL_ID, expect.stringContaining('top-secret-access-token'));
  });

  it('rejects a mismatched state before token exchange or credential persistence', async () => {
    const vault = new MemoryVault();
    const http = { fetch: vi.fn() };
    const service = new LinkedInOAuthService(vault, {
      authorize: vi.fn(async () => ({ code: 'code', state: 'attacker-state', redirectUri: 'http://127.0.0.1:1/callback' })),
    }, {
      randomUrlSafe: (size) => Buffer.alloc(size, 1).toString('base64url'),
      sha256UrlSafe: (value) => `challenge-${value.length}`,
    }, http, () => new Date());
    await expect(service.connect(configuration, new AbortController().signal)).rejects.toThrow('state validation');
    expect(http.fetch).not.toHaveBeenCalled();
    expect(vault.set).not.toHaveBeenCalled();
  });

  it('reports saved setup as disconnected and expired credentials honestly', async () => {
    const vault = new MemoryVault();
    const service = new LinkedInOAuthService(vault, { authorize: vi.fn() }, {
        randomUrlSafe: () => 'random', sha256UrlSafe: () => 'challenge',
      }, { fetch: vi.fn() }, () => new Date('2026-09-11T10:00:00.000Z'));
    expect(await service.status(configuration)).toEqual({ state: 'disconnected' });
    vault.value = JSON.stringify({
      accessToken: 'encrypted-only-token-value', tokenType: 'Bearer', expiresAt: '2026-09-11T09:00:00.000Z',
      scopes: LINKEDIN_SCOPES, clientId: configuration.clientId,
      member: { subject: 'abc', authorUrn: 'urn:li:person:abc' },
    });
    expect(await service.status(configuration)).toMatchObject({ state: 'expired', member: { subject: 'abc' } });
  });
});
