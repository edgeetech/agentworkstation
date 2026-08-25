# ADR-005 Intelligence Boundary

Decision: agents depend on IntelligenceService / IntelligencePort, not provider SDKs.

Rationale: the application must control policy, routing, and portability independently of any model provider.

