import { z } from 'zod';

export const IPC_CHANNELS = {
  getDemoAudit: 'agentWorkstation:getDemoAudit',
  pickWorkspaceDirectory: 'agentWorkstation:pickWorkspaceDirectory',
  pickSourceFile: 'agentWorkstation:pickSourceFile',
  listWorkspaces: 'agentWorkstation:listWorkspaces',
  removeWorkspace: 'agentWorkstation:removeWorkspace',
  listAgentSources: 'agentWorkstation:listAgentSources',
  addAgentSource: 'agentWorkstation:addAgentSource',
  removeAgentSource: 'agentWorkstation:removeAgentSource',
  setSourceNote: 'agentWorkstation:setSourceNote',
  listWorkspaceEntries: 'agentWorkstation:listWorkspaceEntries',
  readWorkspaceFile: 'agentWorkstation:readWorkspaceFile',
  getEndpointConfig: 'agentWorkstation:getEndpointConfig',
  listProviderConnections: 'agentWorkstation:listProviderConnections',
  discoverLocalModels: 'agentWorkstation:discoverLocalModels',
  saveEndpointConfig: 'agentWorkstation:saveEndpointConfig',
  testEndpointConnection: 'agentWorkstation:testEndpointConnection',
  listAgents: 'agentWorkstation:listAgents',
  saveAgentProfile: 'agentWorkstation:saveAgentProfile',
  getCustomAgentSetup: 'agentWorkstation:getCustomAgentSetup',
  draftCustomAgent: 'agentWorkstation:draftCustomAgent',
  getCustomAgent: 'agentWorkstation:getCustomAgent',
  getBuiltInInstructions: 'agentWorkstation:getBuiltInInstructions',
  saveBuiltInInstructions: 'agentWorkstation:saveBuiltInInstructions',
  resetBuiltInInstructions: 'agentWorkstation:resetBuiltInInstructions',
  createCustomAgent: 'agentWorkstation:createCustomAgent',
  updateCustomAgent: 'agentWorkstation:updateCustomAgent',
  deleteCustomAgent: 'agentWorkstation:deleteCustomAgent',
  getAgentOnboarding: 'agentWorkstation:getAgentOnboarding',
  getAgentMemory: 'agentWorkstation:getAgentMemory',
  openAgentMemoryFile: 'agentWorkstation:openAgentMemoryFile',
  getPublicationSetup: 'agentWorkstation:getPublicationSetup',
  listPublicationCandidates: 'agentWorkstation:listPublicationCandidates',
  savePublicationSiteTarget: 'agentWorkstation:savePublicationSiteTarget',
  clearPublicationSiteTarget: 'agentWorkstation:clearPublicationSiteTarget',
  saveLinkedInPublisherConfiguration: 'agentWorkstation:saveLinkedInPublisherConfiguration',
  connectLinkedIn: 'agentWorkstation:connectLinkedIn',
  disconnectLinkedIn: 'agentWorkstation:disconnectLinkedIn',
  startPublication: 'agentWorkstation:startPublication',
  startPublicationCandidate: 'agentWorkstation:startPublicationCandidate',
  approveSitePublication: 'agentWorkstation:approveSitePublication',
  publishSite: 'agentWorkstation:publishSite',
  retrySiteVerification: 'agentWorkstation:retrySiteVerification',
  requestLinkedInApproval: 'agentWorkstation:requestLinkedInApproval',
  approveLinkedIn: 'agentWorkstation:approveLinkedIn',
  shareLinkedIn: 'agentWorkstation:shareLinkedIn',
  retryLinkedInVerification: 'agentWorkstation:retryLinkedInVerification',
  archivePublication: 'agentWorkstation:archivePublication',
  listChatSessions: 'agentWorkstation:listChatSessions',
  createChatSession: 'agentWorkstation:createChatSession',
  renameChatSession: 'agentWorkstation:renameChatSession',
  setChatSessionMode: 'agentWorkstation:setChatSessionMode',
  deleteChatSession: 'agentWorkstation:deleteChatSession',
  selectChatSession: 'agentWorkstation:selectChatSession',
  getChatHistory: 'agentWorkstation:getChatHistory',
  getChatContextUsage: 'agentWorkstation:getChatContextUsage',
  sendChatMessage: 'agentWorkstation:sendChatMessage',
  cancelChatMessage: 'agentWorkstation:cancelChatMessage',
  openExternalLink: 'agentWorkstation:openExternalLink',
  listPendingActions: 'agentWorkstation:listPendingActions',
  getProposalTally: 'agentWorkstation:getProposalTally',
  proposeProfileUpdate: 'agentWorkstation:proposeProfileUpdate',
  approvePendingAction: 'agentWorkstation:approvePendingAction',
  rejectPendingAction: 'agentWorkstation:rejectPendingAction',
  setWindowTheme: 'agentWorkstation:setWindowTheme',
  getUsageLedgerSettings: 'agentWorkstation:getUsageLedgerSettings',
  setUsageLedgerEnabled: 'agentWorkstation:setUsageLedgerEnabled',
  openUsageLedgerFolder: 'agentWorkstation:openUsageLedgerFolder',
  getReminderSettings: 'agentWorkstation:getReminderSettings',
  setReminderSettings: 'agentWorkstation:setReminderSettings',
  getAppVersion: 'agentWorkstation:getAppVersion',
  installUpdateNow: 'agentWorkstation:installUpdateNow',
} as const;

/** Main-to-renderer push events (sent with webContents.send, never invoked). */
export const IPC_EVENTS = {
  chatActivity: 'agentWorkstation:chatActivity',
  openAgent: 'agentWorkstation:openAgent',
  updateReady: 'agentWorkstation:updateReady',
} as const;

const windowThemeSchema = z.object({
  theme: z.enum(['light', 'dark']),
});

export function parseWindowThemeInput(value: unknown): { theme: 'light' | 'dark' } {
  return windowThemeSchema.parse(value);
}

const usageLedgerEnabledSchema = z.object({
  enabled: z.boolean(),
});

export function parseUsageLedgerEnabledInput(value: unknown): { enabled: boolean } {
  return usageLedgerEnabledSchema.parse(value);
}

const workspaceIdSchema = z.object({
  id: z.string().min(1),
});

const agentIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const sourceNoteSchema = z.string().trim().max(200).refine((value) => !/\p{Cc}/u.test(value), 'Source note cannot contain control characters');

const addAgentSourceSchema = z.object({
  agentId: agentIdSchema,
  location: z.string().trim().min(1).max(2_048),
  note: sourceNoteSchema.optional(),
}).strict();

const agentSourceSchema = z.object({ agentId: agentIdSchema, sourceId: z.string().min(1) }).strict();
const setSourceNoteSchema = z.object({ sourceId: z.string().min(1), note: sourceNoteSchema }).strict();
const listAgentSourcesSchema = z.object({ agentId: agentIdSchema }).strict();

const endpointConfigSchema = z.object({
  mode: z.enum(['mock', 'local', 'delegated']),
  baseUrl: z.string().min(1),
  modelId: z.string().min(1),
  providerId: z.string().regex(/^[a-z0-9-]+$/).optional(),
  providerModelId: z.string().min(1).optional(),
  routingPolicy: z.enum(['local_only', 'local_first', 'adaptive']).optional(),
  ollamaModelIds: z.array(z.string().min(1)).optional(),
  providerIds: z.array(z.string().regex(/^[a-z0-9-]+$/)).optional(),
  allowedPaths: z.object({
    localModels: z.boolean(),
    ollamaCloudModels: z.boolean().optional(),
    cloudProviders: z.boolean(),
  }).optional(),
}).superRefine((value, context) => {
  const cloudAllowed = value.allowedPaths?.cloudProviders
    ?? (value.mode === 'delegated' || (value.routingPolicy !== undefined && value.routingPolicy !== 'local_only'));
  const providerIds = value.providerIds ?? (value.providerId ? [value.providerId] : []);
  if (cloudAllowed && providerIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cloud providers require an explicit allowlist' });
  }
  if (new Set(providerIds).size !== providerIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provider priority list cannot contain duplicates' });
  }
  if (value.providerId && providerIds.length > 0 && value.providerId !== providerIds[0]) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'providerId must match the first allowed provider' });
  }
  if (value.mode !== 'mock' && value.allowedPaths && !value.allowedPaths.localModels
    && !value.allowedPaths.ollamaCloudModels && !value.allowedPaths.cloudProviders) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Allow at least one intelligence path' });
  }
});

const agentOnboardingSchema = z.object({
  agentId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  intent: z.enum(['initial', 'publish', 'linkedin']).default('initial'),
});

const agentIdInputSchema = z.object({ agentId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/) });

const draftCustomAgentSchema = z.object({
  name: z.string().trim().min(1).max(48),
  brief: z.string().trim().min(1).max(4_000),
  language: z.enum(['tr', 'en']),
});

const updateCustomAgentSchema = agentIdInputSchema.extend({ input: z.unknown() });

export function parseCustomAgentIdInput(value: unknown): { agentId: string } {
  return agentIdInputSchema.parse(value);
}

export function parseDraftCustomAgentInput(value: unknown): { name: string; brief: string; language: 'tr' | 'en' } {
  return draftCustomAgentSchema.parse(value);
}

export function parseUpdateCustomAgentInput(value: unknown): { agentId: string; input: unknown } {
  const { agentId, input } = updateCustomAgentSchema.parse(value);
  return { agentId, input };
}

const saveAgentProfileSchema = z.object({
  agentId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  displayName: z.string()
    .trim()
    .min(1)
    .max(48)
    .refine((value) => !/\p{Cc}/u.test(value), 'Agent display name cannot contain control characters')
    .nullable(),
  tagline: z.string()
    .trim()
    .max(60)
    .refine((value) => !/\p{Cc}/u.test(value), 'Agent title cannot contain control characters')
    .nullable(),
}).strict();

export function parseAgentOnboardingInput(value: unknown): {
  agentId: string;
  intent: 'initial' | 'publish' | 'linkedin';
} {
  return agentOnboardingSchema.parse(value);
}

export function parseSaveAgentProfileInput(value: unknown): { agentId: string; displayName: string | null; tagline: string | null } {
  return saveAgentProfileSchema.parse(value);
}

const workspacePathSchema = z.object({
  workspaceId: z.string().min(1),
  relativePath: z.string().min(1).max(4096),
});

const requestIdSchema = z.string().uuid();

const chatMessageSchema = z.object({
  message: z.string().min(1),
  requestId: requestIdSchema,
  sessionId: z.string().min(1),
  resume: z.boolean().optional(),
});

const cancelChatMessageSchema = z.object({
  requestId: requestIdSchema,
});

const externalLinkSchema = z.object({
  url: z.string().url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  }, 'Only HTTP and HTTPS links are allowed'),
});

const createChatSessionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  workspaceId: z.string().min(1).optional(),
  agentId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).default('career'),
  intelligencePreference: z.literal('auto').default('auto'),
  permissionMode: z.literal('interactive').default('interactive'),
  isolationMode: z.literal('read_only').default('read_only'),
});

const publicationSiteTargetSchema = z.object({
  displayDomain: z.string().trim().min(1).max(253),
  workspaceId: z.string().trim().min(1).max(128),
  contentDirectory: z.string().trim().min(1).max(4096),
  publishBranch: z.string().trim().min(1).max(128),
  approvedAssetDirectories: z.array(z.string().trim().min(1).max(512)).optional(),
  publicBaseUrl: z.string().trim().url().optional(),
}).strict();

const linkedInConnectionReferenceSchema = z.object({
  reference: z.string().trim().min(1).max(256),
}).strict();

const linkedInPublisherConfigurationSchema = z.object({
  clientId: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/u),
  apiVersion: z.string().regex(/^\d{6}$/u).refine((value) => {
    const month = Number(value.slice(4));
    return month >= 1 && month <= 12;
  }, 'LinkedIn API version must use a valid YYYYMM value'),
}).strict();

const linkedInApprovalRequestSchema = z.object({
  commentary: z.string().min(1).max(3_000).refine((value) => Boolean(value.trim()), 'Commentary is required'),
}).strict();

const publicationArtifactPathSchema = z.string().trim().min(1).max(1024);
const startPublicationSchema = z.object({
  contentId: z.string().trim().min(1).max(256),
  primaryArticlePath: publicationArtifactPathSchema,
  translationPaths: z.array(publicationArtifactPathSchema).min(1).max(100),
  visualAssetPaths: z.array(publicationArtifactPathSchema).max(100).optional(),
  otherAssetPaths: z.array(publicationArtifactPathSchema).max(100).optional(),
}).strict().superRefine((value, context) => {
  const paths = [
    value.primaryArticlePath,
    ...value.translationPaths,
    ...(value.visualAssetPaths ?? []),
    ...(value.otherAssetPaths ?? []),
  ];
  if (new Set(paths.map((item) => item.replaceAll('\\', '/').toLowerCase())).size !== paths.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Publication artifact paths must be unique' });
  }
});
const startPublicationCandidateSchema = z.object({
  candidateId: z.string().regex(/^[0-9a-f]{64}$/u),
  primaryLanguage: z.enum(['tr', 'en']),
}).strict();
const publicationNoPayloadSchema = z.undefined();
const installUpdateSchema = z.undefined();

const renameChatSessionSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
});

const setChatSessionModeSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(['standard', 'autopilot']),
});

const proposeProfileUpdateSchema = z.object({
  workspaceId: z.string().min(1),
  targetPath: z.string().min(1),
  recommendation: z.string().min(1),
});

const modelDiscoverySchema = z.object({
  baseUrl: z.string().url(),
});

const approveSchema = z.object({
  actionId: z.string().min(1),
});

const rejectSchema = z.object({
  actionId: z.string().min(1),
  reason: z.string().min(1),
});

const reminderSettingsSchema = z.object({
  accountantDeadlines: z.boolean(),
}).strict();

export function parseReminderSettingsInput(value: unknown): { accountantDeadlines: boolean } {
  return reminderSettingsSchema.parse(value);
}

export function parseApprovePendingActionInput(value: unknown): { actionId: string } {
  return approveSchema.parse(value);
}

export function parseWorkspaceIdInput(value: unknown): { id: string } {
  return workspaceIdSchema.parse(value);
}

export function parseAddAgentSourceInput(value: unknown): { agentId: string; location: string; note?: string } {
  return addAgentSourceSchema.parse(value);
}

export function parseAgentSourceInput(value: unknown): { agentId: string; sourceId: string } {
  return agentSourceSchema.parse(value);
}

export function parseSetSourceNoteInput(value: unknown): { sourceId: string; note: string } {
  return setSourceNoteSchema.parse(value);
}

const builtInInstructionsSchema = z.object({
  agentId: agentIdSchema,
  instructions: z.string().trim().min(1).max(64 * 1024),
  rules: z.string().max(64 * 1024),
}).strict();

export function parseSaveBuiltInInstructionsInput(value: unknown): { agentId: string; instructions: string; rules: string } {
  return builtInInstructionsSchema.parse(value);
}

export function parseListAgentSourcesInput(value: unknown): { agentId: string } {
  return listAgentSourcesSchema.parse(value);
}

export function parseEndpointConfigInput(value: unknown): {
  mode: 'mock' | 'local' | 'delegated';
  baseUrl: string;
  modelId: string;
  providerId?: string;
  providerModelId?: string;
  routingPolicy?: 'local_only' | 'local_first' | 'adaptive';
  ollamaModelIds?: string[];
  providerIds?: string[];
  allowedPaths?: { localModels: boolean; ollamaCloudModels?: boolean; cloudProviders: boolean };
} {
  return endpointConfigSchema.parse(value);
}

export function parseChatMessageInput(value: unknown): { message: string; requestId: string; sessionId: string; resume?: boolean } {
  return chatMessageSchema.parse(value);
}

export function parseCancelChatMessageInput(value: unknown): { requestId: string } {
  return cancelChatMessageSchema.parse(value);
}

export function parseExternalLinkInput(value: unknown): { url: string } {
  return externalLinkSchema.parse(value);
}

export function registerChatRequest(
  controllers: Map<string, AbortController>,
  requestId: string,
): AbortController {
  if (controllers.has(requestId)) {
    throw new Error(`Chat request is already running: ${requestId}`);
  }
  const controller = new AbortController();
  controllers.set(requestId, controller);
  return controller;
}

export function cancelChatRequest(
  controllers: Map<string, AbortController>,
  requestId: string,
): boolean {
  const controller = controllers.get(requestId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function releaseChatRequest(
  controllers: Map<string, AbortController>,
  requestId: string,
  controller: AbortController,
): void {
  if (controllers.get(requestId) === controller) {
    controllers.delete(requestId);
  }
}

export function parseCreateChatSessionInput(value: unknown): {
  name: string;
  workspaceId?: string;
  agentId: string;
  intelligencePreference: 'auto';
  permissionMode: 'interactive';
  isolationMode: 'read_only';
} {
  return createChatSessionSchema.parse(value);
}

export function parsePublicationSiteTargetInput(value: unknown): {
  displayDomain: string;
  workspaceId: string;
  contentDirectory: string;
  publishBranch: string;
  approvedAssetDirectories?: string[];
  publicBaseUrl?: string;
} {
  return publicationSiteTargetSchema.parse(value);
}

export function parseLinkedInConnectionReferenceInput(value: unknown): { reference: string } {
  return linkedInConnectionReferenceSchema.parse(value);
}

export function parseLinkedInPublisherConfigurationInput(value: unknown): { clientId: string; apiVersion: string } {
  return linkedInPublisherConfigurationSchema.parse(value);
}

export function parseLinkedInApprovalRequestInput(value: unknown): { commentary: string } {
  return linkedInApprovalRequestSchema.parse(value);
}

export function parseStartPublicationInput(value: unknown): {
  contentId: string;
  primaryArticlePath: string;
  translationPaths: string[];
  visualAssetPaths?: string[];
  otherAssetPaths?: string[];
} {
  return startPublicationSchema.parse(value);
}

export function parseStartPublicationCandidateInput(value: unknown): {
  candidateId: string;
  primaryLanguage: 'tr' | 'en';
} {
  return startPublicationCandidateSchema.parse(value);
}

export function parsePublicationNoPayloadInput(value: unknown): undefined {
  return publicationNoPayloadSchema.parse(value);
}

export function parseWorkspacePathInput(value: unknown): { workspaceId: string; relativePath: string } {
  return workspacePathSchema.parse(value);
}

export function parseRenameChatSessionInput(value: unknown): { id: string; name: string } {
  return renameChatSessionSchema.parse(value);
}

export function parseSetChatSessionModeInput(value: unknown): { id: string; mode: 'standard' | 'autopilot' } {
  return setChatSessionModeSchema.parse(value);
}

export function parseProposeProfileUpdateInput(value: unknown): {
  workspaceId: string;
  targetPath: string;
  recommendation: string;
} {
  return proposeProfileUpdateSchema.parse(value);
}

export function parseModelDiscoveryInput(value: unknown): { baseUrl: string } {
  return modelDiscoverySchema.parse(value);
}

export function parseRejectPendingActionInput(value: unknown): { actionId: string; reason: string } {
  return rejectSchema.parse(value);
}

export function parseInstallUpdateInput(value: unknown): undefined {
  return installUpdateSchema.parse(value);
}
