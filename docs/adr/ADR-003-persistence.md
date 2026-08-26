# ADR-003 Persistence

**Date:** 2026-08-25
**Status:** Accepted

## Context
Operational sessions and pending actions require local durability without a server.

## Decision
Use SQLite behind Application persistence ports. Credentials are explicitly excluded from SQLite.

## Alternatives
JSON files are weak for migrations and concurrent updates; a remote database conflicts with Release 0.1 local-first behavior.

## Consequences
Schema migrations and native-module packaging require per-platform verification. Credentials use a separate OS-vault port.

## Verification
`tests/unit/sqlitePersistence.test.ts` exercises the adapter.

