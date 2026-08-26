# ADR-006 Local Model Endpoint Protocol

Decision: the primary local runtime boundary is an OpenAI-compatible HTTP endpoint, with Ollama as the first tested runtime.

Rationale: this keeps the app runtime-neutral while supporting the installed local model stack.

