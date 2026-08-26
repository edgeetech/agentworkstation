# ADR-004 Workspace Security

**Date:** 2026-08-25
**Status:** Accepted

## Context
Agent-selected paths are untrusted and Windows/macOS resolve paths and links differently.

## Decision
All workspace access uses WorkspaceGateway for allowlisted roots, canonical paths, traversal/symlink protection, size limits, and case-insensitive sensitive-file filtering.

## Alternatives
Absolute paths and tool-specific checks were rejected because they bypass or duplicate policy.

## Consequences
Directory listings filter sensitive names as well as blocking content.

## Verification
`tests/security/workspaceGateway.security.test.ts` covers traversal, links, secrets, size, and unknown workspaces.

