import fs from 'node:fs';
import path from 'node:path';

export type AgentDefinition = {
  id: string;
  name: string;
  description: string;
  instructions: string[];
  systemPrompt: string;
  toolPolicies: Record<string, 'allow' | 'require_approval' | 'deny'>;
};

export class CareerAgentLoader {
  constructor(private readonly agentDir: string) {}

  load(): AgentDefinition {
    const yamlPath = path.join(this.agentDir, 'agent.yaml');
    const raw = fs.readFileSync(yamlPath, 'utf8');
    const id = this.extractField(raw, 'id');
    const name = this.extractField(raw, 'name');
    const description = this.extractField(raw, 'description');

    // Load instruction files
    const instructionFiles = this.extractList(raw, 'instructions');
    const instructions: string[] = [];
    for (const file of instructionFiles) {
      const filePath = path.join(this.agentDir, file);
      if (fs.existsSync(filePath)) {
        instructions.push(fs.readFileSync(filePath, 'utf8'));
      }
    }

    // Build system prompt from instructions
    const systemPrompt = instructions.join('\n\n---\n\n');

    // Parse tool policies block
    const toolPolicies: Record<string, 'allow' | 'require_approval' | 'deny'> = {};
    const toolPoliciesMatch = raw.match(/toolPolicies:\s*([\s\S]*?)(?:\n\w|$)/);
    if (toolPoliciesMatch) {
      const block = toolPoliciesMatch[1];
      const lines = block.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const m = line.match(/^\s*(\S+):\s*(\S+)/);
        if (m) {
          const policy = m[2].trim() as 'allow' | 'require_approval' | 'deny';
          toolPolicies[m[1]] = policy;
        }
      }
    }

    return { id, name, description, instructions, systemPrompt, toolPolicies };
  }

  private extractField(yaml: string, field: string): string {
    const m = yaml.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  }

  private extractList(yaml: string, field: string): string[] {
    const m = yaml.match(new RegExp(`^${field}:\\s*([\\s\\S]*?)(?=^\\S|$)`, 'm'));
    if (!m) return [];
    return m[1].split('\n')
      .map(l => l.trim().replace(/^-\s*/, ''))
      .filter(l => l.length > 0);
  }
}
