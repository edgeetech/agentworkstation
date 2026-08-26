# ADR-009 Platform Abstraction

**Date:** 2026-08-25
**Status:** Accepted

## Context
Windows ships first; filesystem, credentials, packaging, and application-data paths differ on macOS.

## Decision
Domain/Application remain platform-neutral. OS behavior belongs in Infrastructure/Desktop adapters.

## Alternatives
Windows-specific Application code was rejected; Linux-first work is deferred.

## Consequences
Native dependencies need per-platform CI and credential storage gets OS-specific implementations behind one port.

## Verification
Architecture tests reject Node imports from Domain/Application; Windows CI is the first quality gate.

