# Publish Site

## Preconditions

- The exact publication package and configured deployment target have explicit human approval.
- The approved package has not changed since approval.
- Required local validation results are current and recorded.

## Process

1. Reconfirm the approval scope, package fingerprint or change list, and deployment target.
2. If approval is missing, ambiguous, stale, or for a different target, stop and request approval.
3. Prepare a human-executable deployment handoff containing exact target details, checks, commands or platform steps, rollback guidance, and post-publication verification criteria.
4. Leave execution to the human or an independently authorized external system.

## Output

A deployment handoff only. Never run deployment commands, push changes, upload content, alter remote state, or report the site as published. Record publication as verified only after the human supplies or authorizes inspection of reliable evidence from the configured destination.
