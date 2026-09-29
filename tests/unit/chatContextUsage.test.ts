import { describe, expect, it } from 'vitest';
import {
  chatContextBudgetFor,
  localChatContextBudget,
  providerChatContextBudget,
  summarizeChatContextUsage,
} from '../../src/application/chatContextUsage';

const chatContextBudget = localChatContextBudget;
import type { ContextBuildResult } from '../../src/application/context';

function result(totalContentBytes: number, truncated: ContextBuildResult['truncated'] = []): ContextBuildResult {
  return {
    request: { messages: [] },
    sourceReferences: [],
    usage: {
      instructionsBytes: totalContentBytes,
      memoryBytes: 0,
      conversationBytes: 0,
      toolResultBytes: 0,
      totalContentBytes,
    },
    truncated,
  };
}

describe('chat context usage', () => {
  it('reports prompt usage as a percentage of the enforced context budget', () => {
    expect(summarizeChatContextUsage(result(chatContextBudget.maxTotalContentBytes / 4), chatContextBudget)).toEqual({
      usedBytes: 16 * 1024,
      limitBytes: 64 * 1024,
      percentage: 25,
      truncatedSections: [],
    });
  });

  it('caps the display at 100 percent and preserves truncation details', () => {
    const usage = summarizeChatContextUsage(result(70 * 1024, ['conversation', 'toolResults']), chatContextBudget);
    expect(usage.percentage).toBe(100);
    expect(usage.truncatedSections).toEqual(['conversation', 'toolResults']);
  });

  it('reports zero for a fresh session even when agent instructions and onboarding prompts exist', () => {
    const usage = summarizeChatContextUsage(
      result(chatContextBudget.maxTotalContentBytes / 4, ['instructions']),
      chatContextBudget,
      { hasUserContext: false },
    );

    expect(usage).toEqual({
      usedBytes: 0,
      limitBytes: 64 * 1024,
      percentage: 0,
      truncatedSections: [],
    });
  });

  it('gives subscription providers room for long pasted sources and keeps local models compact', () => {
    expect(chatContextBudgetFor('local_only')).toBe(localChatContextBudget);
    expect(chatContextBudgetFor('provider_allowed')).toBe(providerChatContextBudget);
    expect(providerChatContextBudget.maxConversationBytes).toBeGreaterThanOrEqual(256 * 1024);
  });
});
