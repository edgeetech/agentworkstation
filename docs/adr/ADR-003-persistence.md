# ADR-003 Persistence

Decision: use SQLite as the canonical operational store.

Rationale: operational state needs local durability, simple migrations, and cross-platform support without adding a server.

