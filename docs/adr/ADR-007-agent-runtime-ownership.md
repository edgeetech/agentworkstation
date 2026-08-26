# ADR-007 Agent Runtime Ownership

**Date:** 2026-08-25
**Status:** Accepted

## Context
The small Release 0.1 runtime contains product-critical safety decisions.

## Decision
Own a minimal provider-neutral loop with step/tool/size/time limits, cancellation, policy, and provenance.

## Alternatives
Third-party runtimes and model-direct tools were rejected because they bypass product control.

## Consequences
Approval remains distinct from denial and is implemented before write tools.

## Verification
`tests/unit/runtime.test.ts` covers final responses, policy, limits, and timeouts.

