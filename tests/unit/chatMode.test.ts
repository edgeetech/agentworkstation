import { describe, expect, it } from 'vitest';
import { buildChatModeInstructions } from '../../src/application/chatMode';

describe('chat mode instructions', () => {
  it('lets autopilot proceed with routine work without bypassing approvals', () => {
    const instructions = buildChatModeInstructions('autopilot');

    expect(instructions).toContain('without asking for confirmation');
    expect(instructions).toContain('Ask a concise question only when');
    expect(instructions).toContain('Do not bypass tool policy');
    expect(instructions).toContain('approval before applying file changes');
  });

  it('keeps standard mode direct while allowing material clarification', () => {
    const instructions = buildChatModeInstructions('standard');

    expect(instructions).toContain('Answer directly');
    expect(instructions).toContain('material ambiguity');
    expect(instructions).toContain('Never ask for information already present');
  });
});
