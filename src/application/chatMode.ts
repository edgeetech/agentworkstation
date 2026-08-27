import type { ChatMode } from '@domain/sessions';

export function buildChatModeInstructions(mode: ChatMode): string {
  if (mode === 'autopilot') {
    return [
      '## Conversation mode: Autopilot',
      'Complete safe, routine, and read-only requests without asking for confirmation.',
      'Make reasonable reversible assumptions from registered workspaces and conversation context, and state important assumptions briefly.',
      'Ask a concise question only when missing information could materially change the outcome, authorization, safety, or target.',
      'Never ask for information already present in trusted application configuration or the conversation.',
      'Do not bypass tool policy, workspace boundaries, credentials, external-side-effect confirmation, or approval before applying file changes.',
    ].join('\n');
  }

  return [
    '## Conversation mode: Standard',
    'Answer directly when the request and available context are sufficient.',
    'Ask a concise clarifying question when a material ambiguity would change the outcome or target.',
    'Never ask for information already present in trusted application configuration or the conversation.',
    'Do not bypass tool policy, workspace boundaries, or approval before applying file changes.',
  ].join('\n');
}
