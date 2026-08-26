import type { NetworkGateway, NetworkRequest, NetworkResponse } from '@application/ports/NetworkGateway';

export class DefaultNetworkGateway implements NetworkGateway {
  async send(request: NetworkRequest, signal: AbortSignal): Promise<NetworkResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal,
    });
    const body = await response.text();
    return { status: response.status, body };
  }
}
