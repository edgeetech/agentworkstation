import type { AgentDefinitionMaterials } from '@application/agents/types';

export interface AgentDefinitionSource {
  load(): AgentDefinitionMaterials;
}
