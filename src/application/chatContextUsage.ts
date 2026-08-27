import type { ContextBuildResult, ContextBudget } from './context';

export const chatContextBudget: ContextBudget = {
  maxInstructionsBytes: 16 * 1024,
  maxMemoryBytes: 8 * 1024,
  maxConversationBytes: 8 * 1024,
  maxToolResultBytes: 16 * 1024,
  maxTotalContentBytes: 48 * 1024,
};

export type ChatContextUsage = {
  usedBytes: number;
  limitBytes: number;
  percentage: number;
  truncatedSections: ContextBuildResult['truncated'];
};

export function summarizeChatContextUsage(result: ContextBuildResult): ChatContextUsage {
  const usedBytes = result.usage.totalContentBytes;
  const limitBytes = chatContextBudget.maxTotalContentBytes;
  const percentage = Math.min(100, Math.max(0, Math.round((usedBytes / limitBytes) * 100)));
  return {
    usedBytes,
    limitBytes,
    percentage,
    truncatedSections: [...result.truncated],
  };
}
