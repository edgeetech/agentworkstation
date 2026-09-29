import type { ModelMessage, ModelRequest, ModelToolDefinition, SourceReference } from '@domain/intelligence';
import type { AgentContentFile } from './agents/types';

export type BoundedContext = {
  content: string;
  byteLength: number;
  truncated: boolean;
  sourceReferences: SourceReference[];
};

export type ContextBudget = {
  maxInstructionsBytes: number;
  maxMemoryBytes: number;
  maxConversationBytes: number;
  maxToolResultBytes: number;
  maxTotalContentBytes: number;
};

export type ContextBuildResult = {
  request: ModelRequest;
  sourceReferences: SourceReference[];
  usage: {
    instructionsBytes: number;
    memoryBytes: number;
    conversationBytes: number;
    toolResultBytes: number;
    totalContentBytes: number;
  };
  truncated: Array<'instructions' | 'memory' | 'conversation' | 'toolResults'>;
};

const TRUNCATION_MARKER = '\n\n[... truncated to fit the context budget]';
const MIN_PARTIAL_MESSAGE_BYTES = 1024;

function truncateUtf8(content: string, maxBytes: number): string {
  const encoded = Buffer.from(content, 'utf8');
  if (encoded.byteLength <= maxBytes) return content;
  return encoded.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/u, '');
}

function contentBytes(messages: ModelMessage[]): number {
  return messages.reduce((total, message) => total + Buffer.byteLength(message.content, 'utf8'), 0);
}

type MessageGroup = { kind: 'conversation' | 'toolResults'; messages: ModelMessage[] };

function groupMessages(messages: ModelMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
      const grouped: ModelMessage[] = [message];
      while (messages[index + 1]?.role === 'tool') {
        const toolMessage = messages[++index];
        if (toolMessage && toolMessage.role === 'tool') grouped.push(toolMessage);
      }
      groups.push({ kind: 'toolResults', messages: grouped });
    } else if (message.role === 'tool') {
      groups.push({ kind: 'toolResults', messages: [message] });
    } else {
      groups.push({ kind: 'conversation', messages: [message] });
    }
  }
  return groups;
}

function validateBudget(budget: ContextBudget): void {
  const values = Object.values(budget);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Context budgets must be non-negative safe integers');
  }
  const categoryTotal = budget.maxInstructionsBytes
    + budget.maxMemoryBytes
    + budget.maxConversationBytes
    + budget.maxToolResultBytes;
  if (categoryTotal > budget.maxTotalContentBytes) {
    throw new Error('Context category budgets exceed total content budget');
  }
}

export class ContextBuilder {
  buildMemory(files: AgentContentFile[], maxBytes: number): BoundedContext {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new Error('Context byte budget must be a non-negative safe integer');
    }

    const ordered = [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const included: string[] = [];
    const sourceReferences: SourceReference[] = [];
    let remainingBytes = maxBytes;
    let truncated = false;

    for (const file of ordered) {
      const separator = included.length > 0 ? '\n\n---\n\n' : '';
      const block = `### ${file.relativePath}\n\n${file.content}`;
      const candidate = separator + block;
      const selected = truncateUtf8(candidate, remainingBytes);
      if (selected) {
        included.push(selected);
        sourceReferences.push({ type: 'memory', relativePath: file.relativePath, label: file.relativePath });
        remainingBytes -= Buffer.byteLength(selected, 'utf8');
      }
      if (selected !== candidate) {
        truncated = true;
        break;
      }
    }

    if (sourceReferences.length < ordered.length) truncated = true;
    const content = included.join('');
    return {
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      truncated,
      sourceReferences,
    };
  }

  buildRequest(input: {
    systemPrompt: string;
    memoryContext: BoundedContext;
    conversation: ModelMessage[];
    tools?: ModelToolDefinition[];
  }, budget: ContextBudget): ContextBuildResult {
    validateBudget(budget);
    const truncated: ContextBuildResult['truncated'] = [];
    const instructions = truncateUtf8(input.systemPrompt, budget.maxInstructionsBytes);
    if (instructions !== input.systemPrompt) truncated.push('instructions');

    const memory = truncateUtf8(input.memoryContext.content, budget.maxMemoryBytes);
    if (memory !== input.memoryContext.content || input.memoryContext.truncated) truncated.push('memory');

    const remaining = {
      conversation: budget.maxConversationBytes,
      toolResults: budget.maxToolResultBytes,
    };
    const selectedGroups: MessageGroup[] = [];
    const groups = groupMessages(input.conversation);
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index];
      const bytes = contentBytes(group.messages);
      if (bytes <= remaining[group.kind]) {
        selectedGroups.unshift(group);
        remaining[group.kind] -= bytes;
      } else if (group.kind === 'conversation') {
        // Keep the head of an oversized message (a pasted article, say) rather than
        // dropping it, then stop: skipping it to reach older turns would leave a gap
        // the model cannot see.
        const message = group.messages[0];
        const room = remaining.conversation - Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
        const minimum = selectedGroups.length === 0 ? 1 : MIN_PARTIAL_MESSAGE_BYTES;
        if (group.messages.length === 1 && message && room >= minimum) {
          selectedGroups.unshift({
            kind: group.kind,
            messages: [{ ...message, content: `${truncateUtf8(message.content, room)}${TRUNCATION_MARKER}` }],
          });
        }
        remaining.conversation = 0;
        if (!truncated.includes('conversation')) truncated.push('conversation');
        break;
      } else if (!truncated.includes(group.kind)) {
        truncated.push(group.kind);
      }
    }

    const selectedMessages = selectedGroups.flatMap((group) => group.messages);
    if (selectedMessages.length < input.conversation.length) {
      const omittedTool = groups.some((group) => group.kind === 'toolResults' && !selectedGroups.includes(group));
      const omittedConversation = groups.some((group) => group.kind === 'conversation' && !selectedGroups.includes(group));
      if (omittedTool && !truncated.includes('toolResults')) truncated.push('toolResults');
      if (omittedConversation && !truncated.includes('conversation')) truncated.push('conversation');
    }

    const messages: ModelMessage[] = [];
    if (instructions) messages.push({ role: 'system', content: instructions });
    if (memory) messages.push({ role: 'system', content: `## Career memory\n\n${memory}` });
    messages.push(...selectedMessages);

    const usage = {
      instructionsBytes: Buffer.byteLength(instructions, 'utf8'),
      memoryBytes: Buffer.byteLength(memory, 'utf8'),
      conversationBytes: contentBytes(selectedGroups.filter((group) => group.kind === 'conversation').flatMap((group) => group.messages)),
      toolResultBytes: contentBytes(selectedGroups.filter((group) => group.kind === 'toolResults').flatMap((group) => group.messages)),
      totalContentBytes: 0,
    };
    usage.totalContentBytes = usage.instructionsBytes + usage.memoryBytes
      + usage.conversationBytes + usage.toolResultBytes;

    const includedSources = input.memoryContext.sourceReferences.filter((source) =>
      !source.relativePath || memory.includes(`### ${source.relativePath}`));
    return {
      request: { messages, ...(input.tools ? { tools: input.tools } : {}) },
      sourceReferences: includedSources,
      usage,
      truncated,
    };
  }
}

