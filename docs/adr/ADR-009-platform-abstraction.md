# ADR-009 Platform Abstraction

Decision: platform-specific concerns live behind infrastructure adapters; domain/application code stays platform-neutral.

Rationale: Windows is the first runtime target, but macOS compatibility must remain feasible without rewrites.

