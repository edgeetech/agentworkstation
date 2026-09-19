import type { CredentialVaultPort } from '../ports/CredentialVaultPort';
import {
  createLinkedInPublisherConfiguration,
  type LinkedInPublisherConfiguration,
} from '../../domain/publication/configuration';

export const LINKEDIN_AUTHORIZATION_ENDPOINT = 'https://www.linkedin.com/oauth/v2/authorization';
export const LINKEDIN_TOKEN_ENDPOINT = 'https://www.linkedin.com/oauth/v2/accessToken';
export const LINKEDIN_USERINFO_ENDPOINT = 'https://api.linkedin.com/v2/userinfo';
export const LINKEDIN_SCOPES = Object.freeze(['openid', 'profile', 'w_member_social'] as const);
export const LINKEDIN_TOKEN_CREDENTIAL_ID = 'linkedin.member.oauth-token';

export type LinkedInMemberIdentity = Readonly<{
  subject: string;
  authorUrn: string;
  displayName?: string;
}>;

export type LinkedInConnectionState = Readonly<{
  state: 'disconnected' | 'connecting' | 'connected' | 'expired' | 'error';
  member?: LinkedInMemberIdentity;
  expiresAt?: string;
  error?: string;
}>;

type StoredToken = Readonly<{
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
  scopes: readonly string[];
  member: LinkedInMemberIdentity;
  clientId: string;
}>;

export type OAuthLoopbackResult = Readonly<{ code: string; state: string; redirectUri: string }>;

export interface OAuthLoopbackPort {
  authorize(
    createAuthorizationUrl: (redirectUri: string) => string,
    signal: AbortSignal,
  ): Promise<OAuthLoopbackResult>;
}

export interface LinkedInHttpPort {
  fetch(url: string, init: RequestInit): Promise<Response>;
}
export interface PkcePort {
  randomUrlSafe(size: number): string;
  sha256UrlSafe(value: string): string;
}

function safeString(value: unknown, label: string, max = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`LinkedIn ${label} is invalid`);
  }
  return value;
}

function parseStoredToken(raw: string): StoredToken {
  const value = JSON.parse(raw) as Partial<StoredToken>;
  const accessToken = safeString(value.accessToken, 'access token', 16_384);
  const expiresAt = safeString(value.expiresAt, 'token expiry');
  if (Number.isNaN(new Date(expiresAt).valueOf())) throw new Error('LinkedIn token expiry is invalid');
  if (value.tokenType !== 'Bearer' || !Array.isArray(value.scopes) || !value.member) {
    throw new Error('LinkedIn credential record is invalid');
  }
  const subject = safeString(value.member.subject, 'member subject');
  const authorUrn = safeString(value.member.authorUrn, 'author URN');
  if (authorUrn !== `urn:li:person:${subject}`) throw new Error('LinkedIn member identity binding is invalid');
  const clientId = safeString(value.clientId, 'credential client ID');
  const scopes = value.scopes.map((scope) => safeString(scope, 'scope', 128));
  if (!LINKEDIN_SCOPES.every((scope) => scopes.includes(scope))) throw new Error('LinkedIn credential scopes are insufficient');
  return Object.freeze({
    accessToken,
    tokenType: 'Bearer',
    expiresAt: new Date(expiresAt).toISOString(),
    scopes: Object.freeze(scopes),
    clientId,
    member: Object.freeze({
      subject,
      authorUrn,
      ...(value.member.displayName ? { displayName: safeString(value.member.displayName, 'member name') } : {}),
    }),
  });
}

export class LinkedInOAuthService {
  private activeConnect: Promise<LinkedInConnectionState> | null = null;
  private activeConnectAbort: AbortController | null = null;
  private lifecycleRevision = 0;
  private lastError: string | undefined;

  constructor(
    private readonly vault: CredentialVaultPort,
    private readonly loopback: OAuthLoopbackPort,
    private readonly pkce: PkcePort,
    private readonly http: LinkedInHttpPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async status(configuration: LinkedInPublisherConfiguration | null): Promise<LinkedInConnectionState> {
    if (this.activeConnect) return Object.freeze({ state: 'connecting' });
    if (this.lastError) return Object.freeze({ state: 'error', error: this.lastError });
    if (!configuration) return Object.freeze({ state: 'disconnected' });
    try {
      const raw = await this.vault.get(LINKEDIN_TOKEN_CREDENTIAL_ID);
      if (!raw) return Object.freeze({ state: 'disconnected' });
      const token = parseStoredToken(raw);
      if (token.clientId !== configuration.clientId) return Object.freeze({ state: 'disconnected' });
      if (new Date(token.expiresAt).valueOf() <= this.now().valueOf()) {
        return Object.freeze({ state: 'expired', member: token.member, expiresAt: token.expiresAt });
      }
      return Object.freeze({ state: 'connected', member: token.member, expiresAt: token.expiresAt });
    } catch {
      return Object.freeze({ state: 'error', error: 'The encrypted LinkedIn credential could not be read' });
    }
  }

  connect(configurationValue: LinkedInPublisherConfiguration, signal: AbortSignal): Promise<LinkedInConnectionState> {
    if (this.activeConnect) {
      return Promise.reject(new Error('A LinkedIn connection attempt is already in progress'));
    }
    const configuration = createLinkedInPublisherConfiguration(configurationValue);
    const revision = this.lifecycleRevision;
    const internalAbort = new AbortController();
    const combinedSignal = AbortSignal.any([signal, internalAbort.signal]);
    this.lastError = undefined;
    const operation = this.performConnect(configuration, combinedSignal, revision);
    this.activeConnect = operation;
    this.activeConnectAbort = internalAbort;
    void operation.finally(() => {
      if (this.activeConnect === operation) {
        this.activeConnect = null;
        this.activeConnectAbort = null;
      }
    }).catch(() => undefined);
    return operation;
  }

  private async performConnect(
    configuration: LinkedInPublisherConfiguration,
    signal: AbortSignal,
    revision: number,
  ): Promise<LinkedInConnectionState> {
    try {
      const state = this.pkce.randomUrlSafe(32);
      const verifier = this.pkce.randomUrlSafe(64);
      const challenge = this.pkce.sha256UrlSafe(verifier);
      const callback = await this.loopback.authorize((redirectUri) => {
        const url = new URL(LINKEDIN_AUTHORIZATION_ENDPOINT);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', configuration.clientId);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('state', state);
        url.searchParams.set('scope', LINKEDIN_SCOPES.join(' '));
        url.searchParams.set('code_challenge', challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        return url.toString();
      }, signal);
      if (callback.state !== state) throw new Error('LinkedIn OAuth state validation failed');
      signal.throwIfAborted();

      const tokenResponse = await this.http.fetch(LINKEDIN_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: callback.code,
          redirect_uri: callback.redirectUri,
          client_id: configuration.clientId,
          code_verifier: verifier,
        }).toString(),
        signal,
      });
      if (!tokenResponse.ok) throw new Error(`LinkedIn token exchange failed (${tokenResponse.status})`);
      const tokenBody = await tokenResponse.json() as Record<string, unknown>;
      const accessToken = safeString(tokenBody.access_token, 'access token', 16_384);
      const expiresIn = Number(tokenBody.expires_in);
      if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('LinkedIn token expiry is invalid');
      const returnedScopes = typeof tokenBody.scope === 'string'
        ? tokenBody.scope.split(/\s+/u).filter(Boolean)
        : [...LINKEDIN_SCOPES];
      if (!LINKEDIN_SCOPES.every((scope) => returnedScopes.includes(scope))) {
        throw new Error('LinkedIn did not grant all required scopes');
      }

      const userInfoResponse = await this.http.fetch(LINKEDIN_USERINFO_ENDPOINT, {
        method: 'GET', headers: { Authorization: `Bearer ${accessToken}` }, signal,
      });
      if (!userInfoResponse.ok) throw new Error(`LinkedIn member identity lookup failed (${userInfoResponse.status})`);
      const userInfo = await userInfoResponse.json() as Record<string, unknown>;
      const subject = safeString(userInfo.sub, 'member subject');
      const name = typeof userInfo.name === 'string' && userInfo.name.trim() ? safeString(userInfo.name, 'member name') : undefined;
      const member = Object.freeze({
        subject,
        authorUrn: `urn:li:person:${subject}`,
        ...(name ? { displayName: name } : {}),
      });
      const expiresAt = new Date(this.now().valueOf() + expiresIn * 1_000).toISOString();
      if (revision !== this.lifecycleRevision) throw new Error('LinkedIn connection was cancelled');
      signal.throwIfAborted();
      await this.vault.set(LINKEDIN_TOKEN_CREDENTIAL_ID, JSON.stringify({
        accessToken, tokenType: 'Bearer', expiresAt, scopes: returnedScopes, member, clientId: configuration.clientId,
      } satisfies StoredToken));
      if (revision !== this.lifecycleRevision || signal.aborted) {
        await this.vault.delete(LINKEDIN_TOKEN_CREDENTIAL_ID);
        signal.throwIfAborted();
        throw new Error('LinkedIn connection was cancelled');
      }
      return Object.freeze({ state: 'connected', member, expiresAt });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'LinkedIn connection failed';
      throw error;
    }
  }

  async disconnect(): Promise<LinkedInConnectionState> {
    this.lifecycleRevision += 1;
    const pending = this.activeConnect;
    this.activeConnectAbort?.abort(new Error('LinkedIn connection was cancelled by disconnect'));
    if (pending) await pending.catch(() => undefined);
    await this.vault.delete(LINKEDIN_TOKEN_CREDENTIAL_ID);
    this.lastError = undefined;
    return Object.freeze({ state: 'disconnected' });
  }

  async getValidCredential(configurationValue: LinkedInPublisherConfiguration): Promise<Readonly<{ accessToken: string; member: LinkedInMemberIdentity }>> {
    const configuration = createLinkedInPublisherConfiguration(configurationValue);
    const raw = await this.vault.get(LINKEDIN_TOKEN_CREDENTIAL_ID);
    if (!raw) throw new Error('LinkedIn is disconnected');
    const token = parseStoredToken(raw);
    if (token.clientId !== configuration.clientId) throw new Error('LinkedIn credential belongs to a different client ID');
    if (new Date(token.expiresAt).valueOf() <= this.now().valueOf()) throw new Error('LinkedIn connection has expired');
    return Object.freeze({ accessToken: token.accessToken, member: token.member });
  }
}
