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

/** Formats a USD turn cost for display; sub-cent amounts keep enough precision to be non-zero. */
export function formatCostUsd(costUsd: number): string {
  return costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(2)}`;
}

/**
 * The model badge must always name a cost, even when none is known (local/simulated
 * routes, or a provider that did not report one), so the user is never left guessing.
 */
export function routeCostLabel(
  route: Pick<RoutingDecision, 'costUsd'>,
  costTemplate: (cost: string) => string,
  naLabel: string,
): string {
  return route.costUsd ? costTemplate(formatCostUsd(route.costUsd)) : naLabel;
}

/** Full model badge text: `<provider> · <model> · <cost>`. */
export function routeBadgeLabel(
  route: RoutingDecision,
  providerSelectedModel: string,
  simulatedModel: string,
  costTemplate: (cost: string) => string,
  naLabel: string,
): string {
  return `${routeDisplayLabel(route, providerSelectedModel, simulatedModel)} · ${routeCostLabel(route, costTemplate, naLabel)}`;
}

/** Model badge tooltip: routing reason, cost, and (when applicable) a provider auth disclosure. */
export function routeBadgeTooltip(
  route: RoutingDecision,
  costTemplate: (cost: string) => string,
  naLabel: string,
): string {
  const base = `${route.reason} · ${routeCostLabel(route, costTemplate, naLabel)}`;
  return route.authDisclosure ? `${base} · ${route.authDisclosure}` : base;
}
