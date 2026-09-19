import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { ExecutionMode, IntelligencePort, ModelRequest, ModelResponse } from '@domain/intelligence';
import { buildProviderPrompt, parseDelegatedModelResponse } from './delegatedCliAdapter';
import { buildDelegatedChildEnv } from './sessionEnv';

/**
 * Unlike Claude Agent SDK's `pathToClaudeCodeExecutable`, Copilot SDK's
 * `RuntimeConnection.forStdio({ path })` takes a literal file path rather than
 * resolving a bare command name against PATH itself, so PATH resolution has to
 * happen here.
 */
function resolveExecutablePath(command: string): string {
  const pathVar = process.env.PATH ?? process.env.Path ?? '';
  // RuntimeConnection.forStdio spawns this path directly, with no shell involved,
  // so only native executables work here: a .cmd/.bat shim (e.g. npm's global
  // install shim) fails with spawn EINVAL, and an extensionless file can share a
  // name with one without being executable (npm's POSIX shell shim). PATHEXT is
  // therefore not honored as-is; only its directly-executable entries are tried.
  const extensions = process.platform === 'win32' ? ['.EXE', '.COM'] : [''];
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`Could not locate "${command}" on PATH. Install GitHub Copilot CLI or set COPILOT_CLI_PATH.`);
}

export type CopilotAgentSdkUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number | null;
  model: string | null;
};

type CopilotPermissionHandler = () => { kind: string } | Promise<{ kind: string }>;

interface CopilotUsageEventData {
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  cost?: number;
  model?: string;
}

interface CopilotErrorEventData {
  errorType: string;
  message: string;
}

interface CopilotSessionLike {
  on(type: 'assistant.usage', handler: (event: { data: CopilotUsageEventData }) => void): () => void;
  on(type: 'session.error', handler: (event: { data: CopilotErrorEventData }) => void): () => void;
  sendAndWait(
    options: { prompt: string },
    timeoutMs: number,
  ): Promise<{ data: { content: string } } | undefined>;
  disconnect(): Promise<void>;
}

interface CopilotClientLike {
  createSession(config: {
    workingDirectory: string;
    onPermissionRequest: CopilotPermissionHandler;
    availableTools: string[];
    systemMessage: { mode: 'replace'; content: string };
    model?: string;
  }): Promise<CopilotSessionLike>;
  stop(): Promise<unknown>;
  forceStop(): Promise<void>;
}

export interface CopilotSdkFacade {
  CopilotClient: new (options: { connection: unknown }) => CopilotClientLike;
  RuntimeConnection: {
    forStdio(options: { path: string; env: Record<string, string> }): unknown;
  };
  approveAll: CopilotPermissionHandler;
}

let cachedSdk: CopilotSdkFacade | null = null;
async function loadCopilotSdk(): Promise<CopilotSdkFacade> {
  cachedSdk ??= (await import('@github/copilot-sdk')) as unknown as CopilotSdkFacade;
  return cachedSdk;
}

const safeModel = (modelId: string): string => {
  if (!/^[a-zA-Z0-9._:/-]+$/.test(modelId)) throw new Error('Invalid delegated model ID');
  return modelId;
};

const RATE_LIMIT_ERROR_TYPES = new Set(['rate_limit', 'quota']);

function toStringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * Runs the GitHub Copilot provider through the real @github/copilot-sdk session
 * API instead of spawning `copilot --silent ... --stream off` and text-parsing
 * stdout. `availableTools: []` fully disables the SDK's own tool loop (Agent
 * Workstation's own ToolExecutor/PolicyGate stays the only place that can execute
 * or approve tools); the model is still asked to answer using the JSON envelope
 * protocol so the response shape matches `DelegatedCliIntelligenceAdapter` exactly.
 */
export class CopilotAgentSdkAdapter implements IntelligencePort {
  private lastUsage: CopilotAgentSdkUsage | null = null;

  constructor(
    private readonly cwd: string,
    private readonly sdkOverride?: CopilotSdkFacade,
  ) {}

  getLastUsage(): CopilotAgentSdkUsage | null {
    return this.lastUsage;
  }

  async execute(
    request: ModelRequest,
    context: { modelId: string; executionMode: ExecutionMode },
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    if (context.executionMode === 'local_only') {
      throw new Error('Delegated provider blocked by local_only policy');
    }
    const { CopilotClient, RuntimeConnection, approveAll } = this.sdkOverride ?? (await loadCopilotSdk());
    // Skipped when a fake SDK is injected for tests: the real filesystem PATH search
    // has nothing to do with the behavior under test and would make tests depend on
    // whether Copilot CLI happens to be installed on the machine running them.
    const executablePath = this.sdkOverride ? 'copilot' : resolveExecutablePath('copilot');
    const usage: CopilotAgentSdkUsage = {
      inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCostUsd: null, model: null,
    };
    let text = '';
    let rateLimited: string | null = null;
    let sessionError: string | null = null;

    const client = new CopilotClient({
      connection: RuntimeConnection.forStdio({ path: executablePath, env: toStringEnv(buildDelegatedChildEnv()) }),
    });
    const onAbort = (): void => { void client.forceStop(); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      signal.throwIfAborted();
      const session = await client.createSession({
        workingDirectory: this.cwd,
        onPermissionRequest: approveAll,
        availableTools: [],
        systemMessage: {
          mode: 'replace',
          content: 'You are an intelligence provider inside Agent Workstation. '
            + 'Follow the response protocol described in the user message exactly and do not use any tools.',
        },
        ...(context.modelId !== 'auto' && context.modelId !== 'default' ? { model: safeModel(context.modelId) } : {}),
      });
      try {
        session.on('assistant.usage', (event) => {
          const data = event.data;
          usage.inputTokens += data.inputTokens ?? 0;
          usage.outputTokens += data.outputTokens ?? 0;
          usage.cacheCreationTokens += data.cacheWriteTokens ?? 0;
          usage.cacheReadTokens += data.cacheReadTokens ?? 0;
          if (typeof data.cost === 'number') usage.totalCostUsd = (usage.totalCostUsd ?? 0) + data.cost;
          if (data.model) usage.model = data.model;
        });
        session.on('session.error', (event) => {
          const data = event.data;
          if (RATE_LIMIT_ERROR_TYPES.has(data.errorType)) {
            rateLimited = data.message;
          } else {
            sessionError = data.message;
          }
        });
        const response = await session.sendAndWait({ prompt: buildProviderPrompt(request) }, 120_000);
        signal.throwIfAborted();
        if (rateLimited) throw new Error(`HTTP 429: GitHub Copilot rate limit: ${rateLimited}`);
        if (sessionError) throw new Error(`GitHub Copilot failed: ${sessionError}`);
        text = response?.data.content ?? '';
      } finally {
        await session.disconnect().catch(() => undefined);
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      await client.stop().catch(() => undefined);
    }
    this.lastUsage = usage;
    if (!text.trim()) throw new Error('GitHub Copilot returned an empty response');
    return parseDelegatedModelResponse(text);
  }
}
