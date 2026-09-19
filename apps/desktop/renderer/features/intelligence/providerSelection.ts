import type { EndpointConfig, ProviderConnection, RoutingDecision } from '../../../shared/api';

export function selectedProviderIds(endpoint: EndpointConfig): string[] {
  const ids = endpoint.providerIds?.length
    ? endpoint.providerIds
    : endpoint.providerId ? [endpoint.providerId] : [];
  return [...new Set(ids)];
}

export function toggleProvider(ids: string[], providerId: string, allowed: boolean): string[] {
  const unique = [...new Set(ids)];
  if (allowed) return unique.includes(providerId) ? unique : [...unique, providerId];
  return unique.filter((id) => id !== providerId);
}

export function moveProvider(ids: string[], providerId: string, offset: -1 | 1): string[] {
  const unique = [...new Set(ids)];
  const current = unique.indexOf(providerId);
  const target = current + offset;
  if (current < 0 || target < 0 || target >= unique.length) return unique;
  const next = [...unique];
  [next[current], next[target]] = [next[target], next[current]];
  return next;
}

export function providerModelLabel(provider: ProviderConnection): string {
  return provider.defaultModel === 'default' || provider.defaultModel === 'auto'
    ? 'provider-default'
    : provider.defaultModel;
}

export function routeDisplayLabel(
  route: RoutingDecision,
  providerSelectedModel: string,
  simulatedModel: string,
): string {
  if (route.location === 'simulated') return simulatedModel;
  const model = route.modelId === 'default' || route.modelId === 'auto'
    ? providerSelectedModel
    : route.modelId;
  return `${route.providerLabel} · ${model}`;
}
