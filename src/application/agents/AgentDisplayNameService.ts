const validAgentId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const controlCharacter = /\p{Cc}/u;

export const maximumAgentDisplayNameLength = 48;
export const agentDisplayNameSettingPrefix = 'agent.displayName.';

export interface AgentDisplayNameSettings {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

function settingKey(agentId: string): string {
  if (!validAgentId.test(agentId)) throw new Error(`Invalid agent id: ${agentId}`);
  return `${agentDisplayNameSettingPrefix}${agentId}`;
}

export function normalizeAgentDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('Agent display name is required');
  if (normalized.length > maximumAgentDisplayNameLength) {
    throw new Error(`Agent display name must be at most ${maximumAgentDisplayNameLength} characters`);
  }
  if (controlCharacter.test(normalized)) {
    throw new Error('Agent display name cannot contain control characters');
  }
  return normalized;
}

export class AgentDisplayNameService {
  constructor(private readonly settings: AgentDisplayNameSettings) {}

  async resolve(agentId: string, defaultName: string): Promise<string> {
    const stored = await this.settings.getSetting(settingKey(agentId));
    if (!stored) return defaultName;
    try {
      return normalizeAgentDisplayName(stored);
    } catch {
      return defaultName;
    }
  }

  async save(agentId: string, name: string | null): Promise<void> {
    await this.settings.setSetting(settingKey(agentId), name === null ? '' : normalizeAgentDisplayName(name));
  }
}
