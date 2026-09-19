import { describe, expect, it, vi } from 'vitest';
import { LINKEDIN_LOOPBACK_REDIRECT_URI, NativeOAuthLoopback } from '../../../src/infrastructure/linkedin/NativeOAuthLoopback';

describe('NativeOAuthLoopback', () => {
  it('opens the system browser and receives only a loopback callback', async () => {
    const openExternal = vi.fn(async (authorizationUrl: string) => {
      const authorization = new URL(authorizationUrl);
      const redirectUri = authorization.searchParams.get('redirect_uri')!;
      const state = authorization.searchParams.get('state')!;
      const response = await fetch(`${redirectUri}?code=one-time-code&state=${encodeURIComponent(state)}`);
      expect(response.status).toBe(200);
    });
    const loopback = new NativeOAuthLoopback({ openExternal }, 5_000);
    const result = await loopback.authorize((redirectUri) => {
      expect(new URL(redirectUri).hostname).toBe('127.0.0.1');
      expect(redirectUri).toBe(LINKEDIN_LOOPBACK_REDIRECT_URI);
      return `https://www.linkedin.com/oauth/v2/authorization?redirect_uri=${encodeURIComponent(redirectUri)}&state=expected-state`;
    }, new AbortController().signal);
    expect(result).toMatchObject({ code: 'one-time-code', state: 'expected-state' });
    expect(openExternal).toHaveBeenCalledOnce();
  });
});
