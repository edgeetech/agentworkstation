import http from 'node:http';
import type { OAuthLoopbackPort, OAuthLoopbackResult } from '../../application/linkedin/connection';

export const LINKEDIN_LOOPBACK_REDIRECT_URI = 'http://127.0.0.1:53682/callback';

export interface ExternalBrowserPort {
  openExternal(url: string): Promise<void>;
}

export class NativeOAuthLoopback implements OAuthLoopbackPort {
  constructor(private readonly browser: ExternalBrowserPort, private readonly timeoutMs = 120_000) {}

  async authorize(createAuthorizationUrl: (redirectUri: string) => string, signal: AbortSignal): Promise<OAuthLoopbackResult> {
    signal.throwIfAborted();
    return new Promise<OAuthLoopbackResult>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, result?: OAuthLoopbackResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        if (server.listening) server.close();
        if (error) reject(error); else resolve(result!);
      };
      const server = http.createServer((request, response) => {
        const address = server.address();
        if (!address || typeof address === 'string') return finish(new Error('LinkedIn loopback address is unavailable'));
        const redirectUri = `http://127.0.0.1:${address.port}/callback`;
        const callback = new URL(request.url ?? '/', redirectUri);
        if (callback.pathname !== '/callback') { response.writeHead(404).end(); return; }
        const error = callback.searchParams.get('error');
        const code = callback.searchParams.get('code');
        const state = callback.searchParams.get('state');
        if (error || !code || !state) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('LinkedIn connection was not completed.');
          finish(new Error(error ? `LinkedIn authorization failed: ${error}` : 'LinkedIn callback was incomplete'));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('LinkedIn connected. You can close this window.');
        finish(undefined, { code, state, redirectUri });
      });
      const onAbort = (): void => finish(new Error('LinkedIn authorization was cancelled'));
      const timeout = setTimeout(() => finish(new Error('LinkedIn authorization timed out')), this.timeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });
      server.on('error', (error) => finish(error));
      server.listen(53682, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') return finish(new Error('LinkedIn loopback address is unavailable'));
        const redirectUri = `http://127.0.0.1:${address.port}/callback`;
        void this.browser.openExternal(createAuthorizationUrl(redirectUri)).catch((error: unknown) =>
          finish(error instanceof Error ? error : new Error('Could not open LinkedIn authorization')));
      });
    });
  }
}
