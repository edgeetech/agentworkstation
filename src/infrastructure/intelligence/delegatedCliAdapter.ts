import { spawn } from 'node:child_process';
import type {
  ExecutionMode,
  IntelligencePort,
  ModelRequest,
  ModelResponse,
  TokenUsage,
} from '@domain/intelligence';

export type DelegatedProviderDefinition = {
  id: string;
  label: string;
  command: string;
  defaultModel: string;
  buildArgs(modelId: string): string[];
  parseOutput(stdout: string): string;
  /** Token usage from the CLI output, for providers that report tokens but no cost. */
  parseUsage?(stdout: string): TokenUsage | null;
  statusArgs?: string[];
  promptTransport?: 'stdin' | 'argument';
  discoverDefaultModel?(statusOutput: string): string | undefined;
};

export type CliExecutionResult = { stdout: string; stderr: string; exitCode: number };

export interface CliProcessRunner {
  run(command: string, args: string[], stdin: string, signal: AbortSignal): Promise<CliExecutionResult>;
}

export class NodeCliProcessRunner implements CliProcessRunner {
  constructor(private readonly cwd: string) {}

  async run(command: string, args: string[], stdin: string, signal: AbortSignal): Promise<CliExecutionResult> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Delegated provider request was cancelled or timed out'));
        return;
      }
      const commandShim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
      const executable = commandShim ? process.env.ComSpec ?? 'cmd.exe' : command;
      const executableArgs = commandShim ? ['/d', '/s', '/c', command, ...args] : args;
      const child = spawn(executable, executableArgs, {
        cwd: this.cwd,
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const append = (current: string, chunk: Buffer): string => {
        const next = current + chunk.toString('utf8');
        if (Buffer.byteLength(next, 'utf8') > 1024 * 1024) {
          child.kill();
          fail(new Error('Delegated provider output exceeded 1 MB'));
        }
        return next;
      };
      child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.on('error', fail);
      child.on('close', (exitCode) => {
        if (settled) return;
        settled = true;
        resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
      });
      signal.addEventListener('abort', () => {
        child.kill();
        fail(new Error('Delegated provider request was cancelled or timed out'));
      }, { once: true });
      child.stdin.end(stdin);
    });
  }
}

const safeModel = (modelId: string): string => {
  if (!/^[a-zA-Z0-9._:/-]+$/.test(modelId)) throw new Error('Invalid delegated model ID');
  return modelId;
};

const providerCommand = (name: string, windowsSuffix: '.cmd' | '.exe'): string =>
  process.platform === 'win32' ? `${name}${windowsSuffix}` : name;

type CodexEvent = {
  type?: string;
  item?: { type?: string; text?: unknown };
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number };
};

function codexEvents(stdout: string): CodexEvent[] {
  return stdout.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return [];
    try {
      return [JSON.parse(trimmed) as CodexEvent];
    } catch {
      return [];
    }
  });
}

export const delegatedProviders: DelegatedProviderDefinition[] = [
  {
    id: 'codex',
    label: 'OpenAI Codex',
    command: providerCommand('codex', '.cmd'),
    defaultModel: 'default',
    statusArgs: ['login', 'status'],
    // --json emits JSONL events; it is the only way Codex reports token usage.
    buildArgs: (modelId) => [
      'exec', '--json', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check',
      '--ignore-user-config', '--ignore-rules',
      ...(modelId === 'default' ? [] : ['--model', safeModel(modelId)]), '-'],
    parseOutput: (stdout) => {
      const messages = codexEvents(stdout)
        .filter((event) => event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string')
        .map((event) => event.item!.text as string);
      if (messages.length === 0) throw new Error('OpenAI Codex returned no message');
      return messages.at(-1)!.trim();
    },
    parseUsage: (stdout) => {
      const turns = codexEvents(stdout).filter((event) => event.type === 'turn.completed' && event.usage);
      if (turns.length === 0) return null;
      return turns.reduce<TokenUsage>((total, event) => ({
        input: total.input + (event.usage!.input_tokens ?? 0),
        cachedInput: total.cachedInput + (event.usage!.cached_input_tokens ?? 0),
        output: total.output + (event.usage!.output_tokens ?? 0) + (event.usage!.reasoning_output_tokens ?? 0),
      }), { input: 0, cachedInput: 0, output: 0 });
    },
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    command: providerCommand('copilot', '.exe'),
    defaultModel: 'auto',
    buildArgs: (modelId) => [
      '--silent', '--no-custom-instructions', '--no-ask-user', '--disable-builtin-mcps',
      '--available-tools=', '--stream', 'off',
      ...(modelId === 'auto' ? [] : ['--model', safeModel(modelId)]),
    ],
    parseOutput: (stdout) => stdout.trim(),
  },
  {
    id: 'claude',
    label: 'Anthropic Claude',
    command: providerCommand('claude', '.exe'),
    defaultModel: 'default',
    statusArgs: ['auth', 'status'],
    buildArgs: (modelId) => [
      '--print', '--output-format', 'json', '--tools=', '--permission-mode', 'dontAsk',
      '--safe-mode', '--no-session-persistence',
      ...(modelId === 'default' ? [] : ['--model', safeModel(modelId)]),
    ],
    parseOutput: (stdout) => {
      const parsed = JSON.parse(stdout) as { result?: unknown };
      if (typeof parsed.result !== 'string') throw new Error('Claude returned an invalid result envelope');
      return parsed.result.trim();
    },
  },
  {
    id: 'devin',
    label: 'Cognition Devin',
    command: providerCommand('devin', '.exe'),
    defaultModel: 'default',
    statusArgs: ['auth', 'status'],
    promptTransport: 'argument',
    discoverDefaultModel: (statusOutput) => statusOutput.match(/^\s*Default model:\s*(\S+)/mi)?.[1],
    buildArgs: (modelId) => [
      '--permission-mode', 'auto', '--print',
      ...(modelId === 'default' ? [] : ['--model', safeModel(modelId)]),
    ],
    parseOutput: (stdout) => stdout.trim(),
  },
];

export function getDelegatedProvider(id: string): DelegatedProviderDefinition {
  const provider = delegatedProviders.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`Unknown delegated provider: ${id}`);
  return provider;
}

export function buildProviderPrompt(request: ModelRequest): string {
  return [
    'You are an intelligence provider inside Agent Workstation.',
    'Do not use your own tools, shell, filesystem, network, plugins, or repository context.',
    'Use only the messages and tool definitions in the JSON payload below.',
    'Return exactly one JSON object and no markdown.',
    'For a final response: {"type":"text","content":"..."}.',
    'To request one tool: {"type":"tool_call","call":{"id":"unique-id","toolName":"name","input":{}}}.',
    JSON.stringify(request),
  ].join('\n');
}

export function parseDelegatedModelResponse(value: string): ModelResponse {
  const unfenced = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Delegated provider did not return structured JSON');
    parsed = JSON.parse(unfenced.slice(start, end + 1));
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Delegated provider returned an invalid response');
  const response = parsed as Record<string, unknown>;
  if (response.type === 'text' && typeof response.content === 'string') {
    return { type: 'text', content: response.content };
  }
  if (response.type === 'tool_call' && response.call && typeof response.call === 'object') {
    const call = response.call as Record<string, unknown>;
    if (typeof call.id === 'string' && typeof call.toolName === 'string' && 'input' in call) {
      return { type: 'tool_call', call: { id: call.id, toolName: call.toolName, input: call.input } };
    }
  }
  throw new Error('Delegated provider returned an unsupported response shape');
}

export class DelegatedCliIntelligenceAdapter implements IntelligencePort {
  private lastTokens: TokenUsage | null = null;

  constructor(
    private readonly provider: DelegatedProviderDefinition,
    private readonly runner: CliProcessRunner,
  ) {}

  /** Read by the router after each turn; delegated CLIs report tokens at best, never cost. */
  getLastUsage(): { totalCostUsd: null; model: null; tokens: TokenUsage | null } {
    return { totalCostUsd: null, model: null, tokens: this.lastTokens };
  }

  async execute(
    request: ModelRequest,
    context: { modelId: string; executionMode: ExecutionMode },
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    if (context.executionMode === 'local_only') {
      throw new Error('Delegated provider blocked by local_only policy');
    }
    const prompt = buildProviderPrompt(request);
    this.lastTokens = null;
    const result = await this.runner.run(
      this.provider.command,
      [
        ...this.provider.buildArgs(context.modelId),
        ...(this.provider.promptTransport === 'argument' ? ['--', prompt] : []),
      ],
      this.provider.promptTransport === 'argument' ? '' : prompt,
      signal,
    );
    if (result.exitCode !== 0) {
      throw new Error(`${this.provider.label} failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
    }
    this.lastTokens = this.provider.parseUsage?.(result.stdout) ?? null;
    return parseDelegatedModelResponse(this.provider.parseOutput(result.stdout));
  }
}
