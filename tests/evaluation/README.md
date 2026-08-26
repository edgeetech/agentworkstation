# Evaluation Harness

Deterministic release-gate scenarios for evidence-backed Career Audit behavior.

## Included scenarios

- `careerAudit.acceptance.test.ts`
  - Runs the Release 0.2 acceptance prompt:
    - "Compare my recent project activity with my current professional profile and identify important gaps."
  - Uses two real temporary git repositories (`profile`, `project`).
  - Verifies multi-workspace audit behavior and structured evidence provenance.
  - Asserts required audit sections and source-reference output shape.
