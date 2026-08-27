import { describe, expect, it } from 'vitest';
import {
  IPC_CHANNELS,
  parseCreateChatSessionInput,
  parseChatMessageInput,
  parseEndpointConfigInput,
  parseProposeProfileUpdateInput,
  parseApprovePendingActionInput,
  parseRejectPendingActionInput,
} from '../../apps/desktop/main/ipcContract';

describe('ipc contract', () => {
  it('exposes stable channel names', () => {
    expect(IPC_CHANNELS.getDemoAudit).toBe('agentWorkstation:getDemoAudit');
    expect(IPC_CHANNELS.approvePendingAction).toBe('agentWorkstation:approvePendingAction');
    expect(IPC_CHANNELS.testEndpointConnection).toBe('agentWorkstation:testEndpointConnection');
  });

  it('validates approve payload', () => {
    expect(parseApprovePendingActionInput({ actionId: 'id-1' })).toEqual({ actionId: 'id-1' });
    expect(() => parseApprovePendingActionInput({ actionId: '' })).toThrow();
  });

  it('validates reject payload', () => {
    expect(parseRejectPendingActionInput({ actionId: 'id-1', reason: 'no' }))
      .toEqual({ actionId: 'id-1', reason: 'no' });
    expect(() => parseRejectPendingActionInput({ actionId: 'id-1', reason: '' })).toThrow();
  });

  it('validates endpoint config and chat payloads', () => {
    expect(parseEndpointConfigInput({ mode: 'mock', baseUrl: 'http://localhost:11434', modelId: 'llama3.1' }))
      .toEqual({ mode: 'mock', baseUrl: 'http://localhost:11434', modelId: 'llama3.1' });
    expect(parseEndpointConfigInput({
      mode: 'delegated', baseUrl: 'http://localhost:11434', modelId: 'default', providerId: 'codex',
    })).toEqual({
      mode: 'delegated', baseUrl: 'http://localhost:11434', modelId: 'default', providerId: 'codex',
    });
    expect(parseChatMessageInput({ message: 'hello' })).toEqual({ message: 'hello' });
    expect(parseCreateChatSessionInput({ name: 'Session A' })).toEqual({ name: 'Session A' });
    expect(parseProposeProfileUpdateInput({
      workspaceId: 'profile',
      targetPath: 'README.md',
      recommendation: 'update summary',
    })).toEqual({ workspaceId: 'profile', targetPath: 'README.md', recommendation: 'update summary' });
    expect(() => parseProposeProfileUpdateInput({ recommendation: 'update summary' })).toThrow();
    expect(() => parseEndpointConfigInput({ mode: 'unknown', baseUrl: '', modelId: '' })).toThrow();
    expect(() => parseEndpointConfigInput({
      mode: 'delegated', baseUrl: 'http://localhost:11434', modelId: 'default',
    })).toThrow();
  });
});
