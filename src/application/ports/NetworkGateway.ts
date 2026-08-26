export type NetworkRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  purpose: string;
  destinationClass: 'local' | 'provider' | 'agentworkstation';
};

export type NetworkResponse = {
  status: number;
  body: string;
};

export interface NetworkGateway {
  send(request: NetworkRequest, signal: AbortSignal): Promise<NetworkResponse>;
}
