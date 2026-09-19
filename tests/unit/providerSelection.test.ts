import { describe, expect, it } from 'vitest';
import {
  moveProvider,
  providerModelLabel,
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
});
