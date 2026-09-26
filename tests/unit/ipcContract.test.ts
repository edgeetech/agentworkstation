import { describe, expect, it } from 'vitest';
import {
  IPC_CHANNELS,
  cancelChatRequest,
  parseCancelChatMessageInput,
  parseCreateChatSessionInput,
  parseRenameAgentDisplayNameInput,
  parseRenameChatSessionInput,
  parseSetChatSessionModeInput,
  parseChatMessageInput,
  parseEndpointConfigInput,
  parseExternalLinkInput,
  parseLinkedInConnectionReferenceInput,
  parseLinkedInPublisherConfigurationInput,
  parseLinkedInApprovalRequestInput,
  parsePublicationSiteTargetInput,
  parsePublicationNoPayloadInput,
  parseStartPublicationInput,
  parseStartPublicationCandidateInput,
  parseProposeProfileUpdateInput,
  parseApprovePendingActionInput,
  parseAgentOnboardingInput,
  parseRejectPendingActionInput,
  parseWorkspacePathInput,
  parseUsageLedgerEnabledInput,
  registerChatRequest,
  releaseChatRequest,
} from '../../apps/desktop/main/ipcContract';

describe('ipc contract', () => {
  it('exposes stable channel names', () => {
    expect(IPC_CHANNELS.getDemoAudit).toBe('agentWorkstation:getDemoAudit');
    expect(IPC_CHANNELS.approvePendingAction).toBe('agentWorkstation:approvePendingAction');
    expect(IPC_CHANNELS.testEndpointConnection).toBe('agentWorkstation:testEndpointConnection');
    expect(IPC_CHANNELS.listAgents).toBe('agentWorkstation:listAgents');
    expect(IPC_CHANNELS.renameAgentDisplayName).toBe('agentWorkstation:renameAgentDisplayName');
    expect(IPC_CHANNELS.getAgentOnboarding).toBe('agentWorkstation:getAgentOnboarding');
    expect(IPC_CHANNELS.getAgentMemory).toBe('agentWorkstation:getAgentMemory');
    expect(IPC_CHANNELS.listWorkspaceEntries).toBe('agentWorkstation:listWorkspaceEntries');
    expect(IPC_CHANNELS.readWorkspaceFile).toBe('agentWorkstation:readWorkspaceFile');
    expect(IPC_CHANNELS.renameChatSession).toBe('agentWorkstation:renameChatSession');
    expect(IPC_CHANNELS.setChatSessionMode).toBe('agentWorkstation:setChatSessionMode');
    expect(IPC_CHANNELS.deleteChatSession).toBe('agentWorkstation:deleteChatSession');
    expect(IPC_CHANNELS.cancelChatMessage).toBe('agentWorkstation:cancelChatMessage');
    expect(IPC_CHANNELS.getPublicationSetup).toBe('agentWorkstation:getPublicationSetup');
    expect(IPC_CHANNELS.listPublicationCandidates).toBe('agentWorkstation:listPublicationCandidates');
    expect(IPC_CHANNELS.startPublicationCandidate).toBe('agentWorkstation:startPublicationCandidate');
    expect(IPC_CHANNELS.publishSite).toBe('agentWorkstation:publishSite');
    expect(IPC_CHANNELS.retrySiteVerification).toBe('agentWorkstation:retrySiteVerification');
    expect(IPC_CHANNELS.connectLinkedIn).toBe('agentWorkstation:connectLinkedIn');
    expect(IPC_CHANNELS.shareLinkedIn).toBe('agentWorkstation:shareLinkedIn');
  });

  it('validates usage ledger enabled payload', () => {
    expect(parseUsageLedgerEnabledInput({ enabled: true })).toEqual({ enabled: true });
    expect(parseUsageLedgerEnabledInput({ enabled: false })).toEqual({ enabled: false });
    expect(() => parseUsageLedgerEnabledInput({ enabled: 'yes' })).toThrow();
    expect(() => parseUsageLedgerEnabledInput({})).toThrow();
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
    const requestId = '00000000-0000-4000-8000-000000000001';
    expect(parseChatMessageInput({ message: 'hello', requestId, sessionId: 'session-1' }))
      .toEqual({ message: 'hello', requestId, sessionId: 'session-1' });
    expect(parseCancelChatMessageInput({ requestId })).toEqual({ requestId });
    expect(parseExternalLinkInput({ url: 'https://example.com/article' }))
      .toEqual({ url: 'https://example.com/article' });
    expect(() => parseExternalLinkInput({ url: 'file:///C:/secret.txt' })).toThrow();
    expect(() => parseExternalLinkInput({ url: 'javascript:alert(1)' })).toThrow();
    expect(() => parseChatMessageInput({ message: 'hello' })).toThrow();
    expect(() => parseCancelChatMessageInput({ requestId: 'not-a-request-id' })).toThrow();
    expect(parseWorkspacePathInput({ workspaceId: 'profile', relativePath: 'src/index.ts' }))
      .toEqual({ workspaceId: 'profile', relativePath: 'src/index.ts' });
    expect(() => parseWorkspacePathInput({ workspaceId: '', relativePath: '' })).toThrow();
    expect(parseCreateChatSessionInput({ name: 'Session A', workspaceId: 'profile' })).toEqual({
      name: 'Session A',
      workspaceId: 'profile',
      agentId: 'career',
      intelligencePreference: 'auto',
      permissionMode: 'interactive',
      isolationMode: 'read_only',
    });
    expect(parseRenameChatSessionInput({ id: 'chat-1', name: 'Renamed chat' }))
      .toEqual({ id: 'chat-1', name: 'Renamed chat' });
    expect(parseRenameAgentDisplayNameInput({ agentId: 'career', displayName: '  My Career  ' }))
      .toEqual({ agentId: 'career', displayName: 'My Career' });
    expect(parseRenameAgentDisplayNameInput({ agentId: 'career', displayName: null }))
      .toEqual({ agentId: 'career', displayName: null });
    expect(() => parseRenameAgentDisplayNameInput({ agentId: 'career', displayName: 'Career\nOverride' })).toThrow();
    expect(() => parseRenameAgentDisplayNameInput({ agentId: 'career', displayName: 'x'.repeat(49) })).toThrow();
    expect(parseSetChatSessionModeInput({ id: 'chat-1', mode: 'autopilot' }))
      .toEqual({ id: 'chat-1', mode: 'autopilot' });
    expect(() => parseSetChatSessionModeInput({ id: 'chat-1', mode: 'unrestricted' })).toThrow();
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
    expect(() => parseEndpointConfigInput({
      mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'qwen3:8b',
      allowedPaths: { localModels: true, cloudProviders: true },
      providerId: 'codex', providerIds: ['copilot', 'codex'],
    })).toThrow('providerId must match the first allowed provider');
    expect(() => parseEndpointConfigInput({
      mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'qwen3:8b',
      allowedPaths: { localModels: true, cloudProviders: true },
      providerId: 'codex', providerIds: ['codex', 'codex'],
    })).toThrow('cannot contain duplicates');
  });

  it('validates agent onboarding reads and intents', () => {
    expect(parseAgentOnboardingInput({ agentId: 'career' })).toEqual({ agentId: 'career', intent: 'initial' });
    expect(parseAgentOnboardingInput({ agentId: 'blogger', intent: 'publish' }))
      .toEqual({ agentId: 'blogger', intent: 'publish' });
    expect(() => parseAgentOnboardingInput({ agentId: '../career', intent: 'initial' })).toThrow();
    expect(() => parseAgentOnboardingInput({ agentId: 'career', intent: 'tokens' })).toThrow();
  });

  it('validates publication setup payloads at the IPC boundary', () => {
    expect(parsePublicationSiteTargetInput({
      displayDomain: 'example.com',
      workspaceId: 'site',
      contentDirectory: 'src/content/writing',
      publishBranch: 'main',
      approvedAssetDirectories: ['public/assets/writing'],
      publicBaseUrl: 'https://example.com/writing',
    })).toEqual({
      displayDomain: 'example.com',
      workspaceId: 'site',
      contentDirectory: 'src/content/writing',
      publishBranch: 'main',
      approvedAssetDirectories: ['public/assets/writing'],
      publicBaseUrl: 'https://example.com/writing',
    });
    expect(parseLinkedInConnectionReferenceInput({ reference: 'linkedin-personal' }))
      .toEqual({ reference: 'linkedin-personal' });
    expect(() => parsePublicationSiteTargetInput({
      displayDomain: '', workspaceId: '', contentDirectory: '', publishBranch: '',
    })).toThrow();
    expect(() => parseLinkedInConnectionReferenceInput({ reference: '' })).toThrow();
    expect(parseLinkedInPublisherConfigurationInput({ clientId: 'public-client', apiVersion: '202608' }))
      .toEqual({ clientId: 'public-client', apiVersion: '202608' });
    expect(() => parseLinkedInPublisherConfigurationInput({
      clientId: 'public-client', apiVersion: '202613', clientSecret: 'must-never-cross-ipc',
    })).toThrow();
    expect(parseLinkedInApprovalRequestInput({ commentary: 'Exact text\nwith whitespace.' }))
      .toEqual({ commentary: 'Exact text\nwith whitespace.' });
    expect(() => parseLinkedInApprovalRequestInput({ commentary: '   ', authorUrn: 'urn:li:person:attacker' }))
      .toThrow();
    expect(parseStartPublicationInput({
      contentId: 'article-1',
      primaryArticlePath: 'src/content/writing/article.md',
      translationPaths: ['src/content/writing/article.tr.md'],
      visualAssetPaths: ['public/images/article.webp'],
    })).toEqual({
      contentId: 'article-1',
      primaryArticlePath: 'src/content/writing/article.md',
      translationPaths: ['src/content/writing/article.tr.md'],
      visualAssetPaths: ['public/images/article.webp'],
    });
    expect(parseStartPublicationCandidateInput({
      candidateId: 'a'.repeat(64), primaryLanguage: 'tr',
    })).toEqual({ candidateId: 'a'.repeat(64), primaryLanguage: 'tr' });
    expect(() => parseStartPublicationCandidateInput({
      candidateId: '../content/article.md', primaryLanguage: 'tr',
    })).toThrow();
    expect(() => parseStartPublicationCandidateInput({
      candidateId: 'a'.repeat(64), primaryLanguage: 'de', primaryArticlePath: 'renderer-controlled.md',
    })).toThrow();
    expect(() => parseStartPublicationInput({
      contentId: 'article-1', primaryArticlePath: 'article.md', translationPaths: [],
    })).toThrow();
    expect(() => parseStartPublicationInput({
      contentId: 'article-1', primaryArticlePath: 'article.md',
      translationPaths: ['article.md'], sha256: 'renderer-controlled',
    })).toThrow();
    expect(() => parsePublicationSiteTargetInput({
      displayDomain: 'example.com', workspaceId: 'site', contentDirectory: 'content',
      publishBranch: 'main', token: 'not-allowed',
    })).toThrow();
    expect(parsePublicationNoPayloadInput(undefined)).toBeUndefined();
    expect(() => parsePublicationNoPayloadInput({})).toThrow();
  });

  it('cancels only the matching running chat request and releases it safely', () => {
    const controllers = new Map<string, AbortController>();
    const olderId = '00000000-0000-4000-8000-000000000001';
    const newerId = '00000000-0000-4000-8000-000000000002';
    const older = registerChatRequest(controllers, olderId);
    const newer = registerChatRequest(controllers, newerId);
    expect(() => registerChatRequest(controllers, newerId)).toThrow('already running');

    expect(cancelChatRequest(controllers, olderId)).toBe(true);
    expect(older.signal.aborted).toBe(true);
    expect(newer.signal.aborted).toBe(false);

    releaseChatRequest(controllers, olderId, older);
    expect(cancelChatRequest(controllers, olderId)).toBe(false);
    expect(newer.signal.aborted).toBe(false);

    const replacement = new AbortController();
    controllers.set(newerId, replacement);
    releaseChatRequest(controllers, newerId, newer);
    expect(controllers.get(newerId)).toBe(replacement);
  });
});
