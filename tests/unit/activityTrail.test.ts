import { describe, expect, it } from 'vitest';
import { describeActivity } from '../../apps/desktop/renderer/features/chat/ActivityTrail';
import type { Translator } from '../../apps/desktop/renderer/i18n';

const t = ((key: string, values?: Record<string, string>) => `${key}${values ? JSON.stringify(values) : ''}`) as unknown as Translator;

describe('activity trail', () => {
  it('names why a tool failed instead of implying it was not permitted', () => {
    expect(describeActivity({ requestId: 'r', type: 'tool_failed', step: 3, toolName: 'web.read', reason: 'web.read request failed with HTTP 404' }, t)?.label)
      .toBe('chat.activityFailedReason{"tool":"web.read","reason":"request failed with HTTP 404"}');
    expect(describeActivity({ requestId: 'r', type: 'tool_failed', step: 3, toolName: 'web.read' }, t)?.label).toBe('chat.activityFailed{"tool":"web.read"}');
  });
});
