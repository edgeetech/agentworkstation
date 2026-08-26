# ADR-010 Licensing and Third-Party Policy

**Date:** 2026-08-25
**Status:** Accepted

## Context
Commercial distribution needs traceable licenses without dependencies owning strategic control flow.

## Decision
Keep the repository proprietary, use narrow commodity libraries behind replaceable boundaries, commit the lockfile, and maintain notices separately.

## Alternatives
Unrestricted dependencies and reimplementing commodity parsers/drivers were rejected.

## Consequences
New dependencies require license review; SBOM publication remains deferred.

## Verification
GitHub CI audits production dependencies; THIRD_PARTY_NOTICES remains a release gate until completed.

