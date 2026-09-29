import type { ChatMode } from '@domain/sessions';

/**
 * Applies to every specialist in every mode. Agents exist to take work off the user,
 * so they must not hand it back: no menus of options, no requests to paste what a tool
 * can fetch, no repeating caveats the user did not ask about.
 */
const OWNERSHIP_INSTRUCTIONS = [
  '## Own the work',
  'Your job is to take work off the user, not to hand it back.',
  'Infer the intent from the whole conversation. When the user pastes text, a link, or a file after asking for something, treat it as material for that earlier request and do the work; never ask what to do with it.',
  'Use your tools before asking for anything: web.search to find sources on a topic, web.read to open pages, and the file and git tools to gather evidence. Search again with different keywords before concluding that nothing exists.',
  'If a page cannot be read, try another source (search results, coverage, a cached or mirror page) before asking the user to paste it.',
  'Deliver a complete first result, then state briefly what you assumed. Do not offer numbered menus of options in place of doing the work.',
  'Ask at most one short question, and only when a missing fact would make the result wrong and no tool can supply it.',
  'Mention approval, publishing, or configuration limits only when the user asks for that step.',
].join('\n');

export function buildChatModeInstructions(mode: ChatMode): string {
  return `${OWNERSHIP_INSTRUCTIONS}\n\n${modeInstructions(mode)}`;
}

function modeInstructions(mode: ChatMode): string {
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
