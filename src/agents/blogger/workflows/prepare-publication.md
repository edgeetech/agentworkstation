# Prepare Publication

## Inputs

- Human-reviewed Turkish and English drafts.
- Approved visual brief or approved local visual asset.
- Editorial preferences and a fully configured deployment target.

## Process

1. Validate titles, slugs, language links, dates, summaries, metadata, source notes, alt text, and asset references.
2. Resolve the target only from `memory/editorial-preferences.md`; stop if provider, repository or workspace, branch, environment, destination, or validation commands are incomplete.
3. Prepare target-specific local file proposals and a validation checklist using only declared safe tools.
4. Produce a review manifest identifying exact content, target, expected changes, checks, and rollback guidance.

## Output

A local publication package and review manifest. Label it `NOT APPROVED FOR PUBLICATION` until a human explicitly approves that exact package and target. Do not deploy or change external state.
