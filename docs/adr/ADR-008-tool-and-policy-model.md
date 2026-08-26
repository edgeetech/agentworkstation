# ADR-008 Tool and Policy Model

**Date:** 2026-08-25
**Status:** Accepted

## Context
Model-generated tool inputs are untrusted and can cross security boundaries.

## Decision
Tools publish JSON schemas, validate again with Zod, carry side-effect metadata, and return provenance. External actions are denied; proposed writes require approval.

## Alternatives
Prompt-only restrictions and a generic shell were rejected.

## Consequences
Wire schemas stay aligned with validators; approval needs a pending-action lifecycle.

## Verification
Tool/runtime tests verify validation, policy, limits, and provenance.

