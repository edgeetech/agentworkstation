# ADR-004 Workspace Security

Decision: all workspace file access goes through WorkspaceGateway with canonical-path, traversal, symlink, size, and secret-file checks.

Rationale: workspace content is untrusted and must not bypass safety checks.

