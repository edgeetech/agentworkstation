import type { ExecutionMode } from '@domain/intelligence';
import type { ContextBuildResult, ContextBudget } from './context';

/**
 * Local Ollama models often run with a few thousand tokens of context, so local-only
 * chats stay compact. Subscription providers (Claude, Codex, Copilot) handle far more,
 * and starving them makes pasted articles or long threads silently disappear.
 */
export const localChatContextBudget: ContextBudget = {
  maxInstructionsBytes: 16 * 1024,
  maxMemoryBytes: 8 * 1024,
  maxConversationBytes: 24 * 1024,
  maxToolResultBytes: 16 * 1024,
  maxTotalContentBytes: 64 * 1024,
};

export const providerChatContextBudget: ContextBudget = {
  maxInstructionsBytes: 32 * 1024,
  maxMemoryBytes: 32 * 1024,
  maxConversationBytes: 256 * 1024,
  maxToolResultBytes: 64 * 1024,
  maxTotalContentBytes: 384 * 1024,
};

export function chatContextBudgetFor(executionMode: ExecutionMode): ContextBudget {
  return executionMode === 'local_only' ? localChatContextBudget : providerChatContextBudget;
}

export type ChatContextUsage = {
  usedBytes: number;
  limitBytes: number;
  percentage: number;
  truncatedSections: ContextBuildResult['truncated'];
};

export function summarizeChatContextUsage(
  result: ContextBuildResult,
  budget: ContextBudget,
  options: { hasUserContext?: boolean } = {},
): ChatContextUsage {
  const usedBytes = options.hasUserContext === false ? 0 : result.usage.totalContentBytes;
  const limitBytes = budget.maxTotalContentBytes;
  const percentage = Math.min(100, Math.max(0, Math.round((usedBytes / limitBytes) * 100)));
  return {
    usedBytes,
    limitBytes,
    percentage,
    truncatedSections: options.hasUserContext === false ? [] : [...result.truncated],
  };
}
