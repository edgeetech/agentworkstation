# ADR-002 Clean Architecture Boundaries

**Date:** 2026-08-25
**Status:** Accepted

## Context
Release 0.1 needs replaceable filesystem, network, persistence, and intelligence adapters without premature package splitting.

## Decision
Use a modular monolith. Domain is dependency-free, Application depends on Domain and owns ports, Infrastructure implements ports, and Desktop is the composition/presentation host.

## Alternatives
Multiple npm packages add unnecessary MVP tooling; framework-owned layering would move policy outside the product.

## Consequences
Infrastructure concerns enter through Application ports, with architecture fitness tests enforcing direction.

## Verification
`npm run check:architecture` checks alias, relative, framework, provider, and Node runtime imports.

