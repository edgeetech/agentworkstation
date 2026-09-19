// Nested-session and gateway-routing markers must never leak into a delegated SDK
// process: a CLI spawned while the host machine is itself inside another agent
// session (messaging socket/session-id env vars) can hang waiting on a handshake
// with a parent that isn't there, and an ambient ANTHROPIC_BASE_URL/TAKSIM_*
// override would silently reroute the call through unrelated local tooling
// (see docs/adr/ADR-011-taksim-integration-boundary.md).
const SESSION_ENV_PREFIXES = ['CLAUDE_CODE_', 'CLAUDE_HOOKS_', 'TAKSIM_'];
const SESSION_ENV_KEYS = new Set(['CLAUDECODE', 'CLAUDE_PID', 'ANTHROPIC_BASE_URL']);

/** A clean copy of process.env with nested-session and gateway-routing markers stripped. */
export function buildDelegatedChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (SESSION_ENV_KEYS.has(key) || SESSION_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete env[key];
    }
  }
  return env;
}
