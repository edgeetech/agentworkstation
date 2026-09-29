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

  it('tells every mode to do the work instead of handing it back to the user', () => {
    for (const mode of ['autopilot', 'standard'] as const) {
      const instructions = buildChatModeInstructions(mode);
      expect(instructions).toContain('never ask what to do with it');
      expect(instructions).toContain('web.search');
      expect(instructions).toContain('Do not offer numbered menus');
    }
  });
});
