import { describe, expect, it } from 'vitest';
import {
  chatContextBudget,
  summarizeChatContextUsage,
} from '../../src/application/chatContextUsage';
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
    expect(summarizeChatContextUsage(result(chatContextBudget.maxTotalContentBytes / 4))).toEqual({
      usedBytes: 12 * 1024,
      limitBytes: 48 * 1024,
      percentage: 25,
      truncatedSections: [],
    });
  });

  it('caps the display at 100 percent and preserves truncation details', () => {
    const usage = summarizeChatContextUsage(result(60 * 1024, ['conversation', 'toolResults']));
    expect(usage.percentage).toBe(100);
    expect(usage.truncatedSections).toEqual(['conversation', 'toolResults']);
  });

  it('reports zero for a fresh session even when agent instructions and onboarding prompts exist', () => {
    const usage = summarizeChatContextUsage(
      result(chatContextBudget.maxTotalContentBytes / 4, ['instructions']),
      { hasUserContext: false },
    );

    expect(usage).toEqual({
      usedBytes: 0,
      limitBytes: 48 * 1024,
      percentage: 0,
      truncatedSections: [],
    });
  });
});
