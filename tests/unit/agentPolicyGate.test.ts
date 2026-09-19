import { describe, expect, it } from 'vitest';
import { AgentPolicyGate } from '../../src/application/tools';

describe('AgentPolicyGate', () => {
  it('denies tools that are not declared by the selected agent', () => {
    const gate = new AgentPolicyGate({ 'filesystem.read': 'allow' });

    const readOnly = { sideEffect: 'none' as const, readOnly: true, sensitive: false };
    expect(gate.decide(readOnly, 'git.status')).toBe('deny');
    expect(gate.decide(readOnly, 'filesystem.read')).toBe('allow');
  });

  it('keeps proposal and external side effects behind safety boundaries', () => {
    const gate = new AgentPolicyGate({
      'filesystem.proposeWrite': 'require_approval',
      'linkedin.publish': 'allow',
    });

    expect(gate.decide({ sideEffect: 'propose', readOnly: false, sensitive: true }, 'filesystem.proposeWrite'))
      .toBe('require_approval');
    expect(gate.decide({ sideEffect: 'external', readOnly: false, sensitive: true }, 'linkedin.publish'))
      .toBe('deny');
  });
});
