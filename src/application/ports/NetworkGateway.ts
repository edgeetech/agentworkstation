import type { ExecutionMode } from '@domain/intelligence';

export type NetworkRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  purpose: string;
  executionMode: ExecutionMode;
};

export type NetworkDestinationClass = 'local' | 'provider' | 'agentworkstation';

export type NetworkActivity = {
  url: string;
  method: string;
  purpose: string;
  destinationClass: NetworkDestinationClass;
  status: number;
  startedAt: string;
  durationMs: number;
};

export type NetworkResponse = {
  status: number;
  body: string;
  activity: NetworkActivity;
};

export interface NetworkGateway {
  send(request: NetworkRequest, signal: AbortSignal): Promise<NetworkResponse>;
}
