import { describe, expect, it } from 'vitest';
import {
  IPC_CHANNELS,
  parseCreateChatSessionInput,
  parseRenameChatSessionInput,
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
    expect(IPC_CHANNELS.renameChatSession).toBe('agentWorkstation:renameChatSession');
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
    expect(parseEndpointConfigInput({
      mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'qwen3:8b',
      routingPolicy: 'adaptive', providerId: 'copilot', providerModelId: 'auto',
    })).toMatchObject({ routingPolicy: 'adaptive', providerId: 'copilot', providerModelId: 'auto' });
    expect(parseEndpointConfigInput({
      mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'qwen3:8b',
      allowedPaths: { localModels: true, cloudProviders: true }, providerId: 'codex',
    })).toMatchObject({ allowedPaths: { localModels: true, cloudProviders: true }, providerId: 'codex' });
    expect(parseEndpointConfigInput({
      mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'gpt-oss:120b-cloud',
      ollamaModelIds: ['gpt-oss:120b-cloud'],
      allowedPaths: { localModels: false, ollamaCloudModels: true, cloudProviders: false },
    })).toMatchObject({ allowedPaths: { ollamaCloudModels: true }, ollamaModelIds: ['gpt-oss:120b-cloud'] });
    expect(parseChatMessageInput({ message: 'hello' })).toEqual({ message: 'hello' });
    expect(parseCreateChatSessionInput({ name: 'Session A' })).toEqual({ name: 'Session A' });
    expect(parseRenameChatSessionInput({ id: 'chat-1', name: 'Renamed chat' }))
      .toEqual({ id: 'chat-1', name: 'Renamed chat' });
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
    expect(() => parseEndpointConfigInput({
      mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'qwen3:8b', routingPolicy: 'local_first',
    })).toThrow();
    expect(() => parseEndpointConfigInput({
      mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'qwen3:8b',
      allowedPaths: { localModels: false, cloudProviders: false },
    })).toThrow();
  });
});
