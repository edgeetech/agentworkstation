import type {
  NetworkActivity,
  NetworkDestinationClass,
  NetworkGateway,
  NetworkRequest,
  NetworkResponse,
} from '@application/ports/NetworkGateway';

type NetworkActivityObserver = (activity: NetworkActivity) => void;

export class DefaultNetworkGateway implements NetworkGateway {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly onActivity: NetworkActivityObserver = () => undefined,
  ) {}

  async send(request: NetworkRequest, signal: AbortSignal): Promise<NetworkResponse> {
    const url = new URL(request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Unsupported network protocol: ${url.protocol}`);
    }

    const destinationClass = this.classifyDestination(url);
    if (request.executionMode === 'local_only' && destinationClass !== 'local') {
      throw new Error('External network blocked: local_only policy');
    }

    const startedAt = new Date();
    const response = await this.fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal,
    });
    const body = await response.text();
    const activity: NetworkActivity = {
      url: request.url,
      method: request.method,
      purpose: request.purpose,
      destinationClass,
      status: response.status,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
    };
    this.onActivity(activity);
    return { status: response.status, body, activity };
  }

  private classifyDestination(url: URL): NetworkDestinationClass {
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
      return 'local';
    }
    return hostname === 'agentworkstation.com' || hostname.endsWith('.agentworkstation.com')
      ? 'agentworkstation'
      : 'provider';
  }
}
