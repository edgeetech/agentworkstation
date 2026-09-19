# ADR-011 Taksim Integration Boundary

**Date:** 2026-09-10
**Status:** Accepted

## Context

Agent Workstation now hosts multiple specialist agents. Taksim is a separate
intelligence execution product and must not become the owner of agent workflows,
workspace access, approvals, or publication state.

## Decision

Agent Workstation continues to own agent definitions, conversations, local
workspace evidence, tool execution, provenance, and every human approval. It
depends only on `IntelligencePort` for model inference.

Taksim may later implement an `IntelligencePort` infrastructure adapter once it
offers a stable provider-neutral request/response contract with atomic routing
metadata. That adapter may select models, apply provider health and quota policy,
and report the route used. It must not execute Agent Workstation tools or turn a
model response into an external action.

The current OpenAI-compatible local adapter must not be pointed at Taksim merely
because both products can launch model clients. Until the normalized contract
exists, Agent Workstation keeps its existing local and delegated adapters.

## Consequences

- Agent Workstation and Taksim remain independently useful products.
- Publishing, LinkedIn sharing, filesystem writes, and their approvals remain in
  Agent Workstation.
- Taksim can evolve routing without coupling to individual specialist agents.
- Route metadata must be returned with the inference result; a mutable
  `getLastDecision()` handoff is not sufficient for concurrent requests.

## Verification

Architecture tests continue to prevent Infrastructure from leaking into Domain
or Application. A future Taksim adapter requires contract tests covering content,
tool calls, cancellation, terminal failures, and request-correlated route data.
