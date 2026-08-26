# ADR-005 Intelligence Boundary

**Date:** 2026-08-25
**Status:** Accepted

## Context
Agents need text and tool calls without coupling workflows to Ollama or provider SDKs.

## Decision
AgentRuntime depends on IntelligencePort and provider-neutral model messages; Infrastructure translates wire formats.

## Alternatives
Provider SDKs in Application and third-party runtimes were rejected because they would own orchestration.

## Consequences
Tool-call identity and results must round-trip through the neutral model.

## Verification
`tests/unit/openaiAdapter.test.ts` verifies content, tool calls, schemas, and tool-result serialization.

