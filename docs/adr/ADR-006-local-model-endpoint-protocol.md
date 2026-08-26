# ADR-006 Local Model Endpoint Protocol

**Date:** 2026-08-25
**Status:** Accepted

## Context
Several local runtimes expose compatible HTTP APIs; native APIs create unnecessary coupling.

## Decision
Use an OpenAI-compatible boundary. Ollama is the first compatibility target, not an architectural dependency.

## Alternatives
Ollama-native APIs and embedded inference are deferred.

## Consequences
The adapter preserves tool-call IDs, assistant calls, tool results, and JSON schemas.

## Verification
Unit contract tests run without Ollama; endpoint compatibility remains a Release 0.1 acceptance gate.

