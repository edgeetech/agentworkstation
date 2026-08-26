# ADR-007 Agent Runtime Ownership

Decision: Agent Workstation owns the minimal agent loop, tool execution, policy, and cancellation logic.

Rationale: strategic execution and safety controls must remain in-house rather than delegated to a third-party agent framework.

