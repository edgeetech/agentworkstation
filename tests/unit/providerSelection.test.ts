import { describe, expect, it } from 'vitest';
import {
  moveProvider,
  providerModelLabel,
  routeBadgeLabel,
  routeBadgeTooltip,
  routeDisplayLabel,
  selectedProviderIds,
  toggleProvider,
} from '../../apps/desktop/renderer/features/intelligence/providerSelection';

describe('provider selection policy', () => {
  it('preserves an explicit allowlist and its fallback order', () => {
    expect(toggleProvider([], 'codex', true)).toEqual(['codex']);
    expect(toggleProvider(['codex'], 'copilot', true)).toEqual(['codex', 'copilot']);
    expect(moveProvider(['codex', 'copilot', 'claude'], 'copilot', -1))
      .toEqual(['copilot', 'codex', 'claude']);
    expect(toggleProvider(['codex', 'copilot', 'claude'], 'devin', false))
      .toEqual(['codex', 'copilot', 'claude']);
  });

  it('does not silently expand legacy or duplicate selections', () => {
    expect(selectedProviderIds({
      mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'local',
      providerIds: ['codex', 'codex', 'claude'],
    })).toEqual(['codex', 'claude']);
    expect(selectedProviderIds({
      mode: 'delegated', baseUrl: 'http://localhost:11434', modelId: 'local', providerId: 'copilot',
    })).toEqual(['copilot']);
  });

  it('replaces opaque automatic model IDs with a presentation token', () => {
    expect(providerModelLabel({
      id: 'codex', label: 'OpenAI Codex', kind: 'delegated_cli', installed: true,
      authenticated: true, detail: '', defaultModel: 'default',
    })).toBe('provider-default');
    expect(routeDisplayLabel({
      policy: 'adaptive', location: 'external', providerId: 'codex', providerLabel: 'OpenAI Codex',
      modelId: 'default', reason: 'preferred', fallback: false,
    }, 'provider-selected model', 'Simulated demo')).toBe('OpenAI Codex · provider-selected model');
  });

  it('always names a cost in the model badge, falling back to n/a when unknown', () => {
    const routeWithCost = {
      policy: 'adaptive' as const, location: 'external' as const, providerId: 'claude', providerLabel: 'Claude',
      modelId: 'sonnet', reason: 'preferred', fallback: false, costUsd: 0.0123,
    };
    expect(routeBadgeLabel(routeWithCost, 'provider-selected model', 'Simulated demo', (cost) => `cost ${cost}`, 'cost n/a'))
      .toBe('Claude · sonnet · cost $0.01');

    const routeWithoutCost = { ...routeWithCost, costUsd: undefined };
    expect(routeBadgeLabel(routeWithoutCost, 'provider-selected model', 'Simulated demo', (cost) => `cost ${cost}`, 'cost n/a'))
      .toBe('Claude · sonnet · cost n/a');
  });

  it('appends the provider auth disclosure to the badge tooltip only when present', () => {
    const base = {
      policy: 'adaptive' as const, location: 'external' as const, providerId: 'claude', providerLabel: 'Claude',
      modelId: 'sonnet', reason: 'preferred', fallback: false,
    };
    expect(routeBadgeTooltip(base, (cost) => `cost ${cost}`, 'cost n/a')).toBe('preferred · cost n/a');
    expect(routeBadgeTooltip(
      { ...base, authDisclosure: 'Uses your local Claude Code login.' },
      (cost) => `cost ${cost}`, 'cost n/a',
    )).toBe('preferred · cost n/a · Uses your local Claude Code login.');
  });
});
