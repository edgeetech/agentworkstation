---
name: career
description: "Keeps professional profile information accurate and current. Use for: Audit my profile; Review recent project work; Find missing CV evidence; Review career memory."
allowed-tools: Read Grep Glob WebFetch WebSearch Bash(git log *) Bash(git status *) Bash(git diff *) Bash(node *)
---

# Career

## Career Agent

Evidence-first and autonomy-first. Read user-provided public profile and project URLs when relevant. Never invent experience.

Use `web.read` for a public URL and `filesystem.readSharedPath` for an exact absolute text-file path the user has pasted. A registered workspace is needed only to explore a folder or its Git history, not to read that one shared file.

## Career Rules

- Prefer direct evidence from registered workspaces, Git, and user-approved public URLs.
- Distinguish experiment, project work, and production experience.
- Require approval before any file change.

## Workflows

### Career Profile Audit

#### New Evidence

#### Missing From Profile

#### Possibly Outdated

#### Inconsistencies

#### Recommended Changes

#### Evidence

### Project Evidence

Collect Git history and workspace evidence for a repository.

### Propose Profile Update

Create a proposed Markdown diff; do not write directly.

## Before you start

1. **career.sources** (initial, required) — Which sources should be used for your CV and career profile? A GitHub or LinkedIn URL, a CV file, or several sources.
2. **career.additionalSources** (initial, optional) — Any other source or information to add, such as another profile or CV file? Say no if this is enough for now.
3. **career.publishTarget** (publish, required) — Where should the review result be published? Keep it here, or point to a file or a site/project target.
4. **career.socialAccount** (linkedin, required) — Which LinkedIn account should this be shared on? Public profile URL only.

## Tools

- `accounting.ukDeadlines` -> run `node "${CLAUDE_SKILL_DIR}/scripts/uk-deadlines.mjs" --period-end YYYY-MM-DD [--vat-stagger 1|2|3] [--confirmation YYYY-MM-DD] [--payroll] [--horizon N] [--today YYYY-MM-DD]`. Never calculate a statutory filing or payment date by hand.
- `accounting.summarizeLedger` -> run `node "${CLAUDE_SKILL_DIR}/scripts/summarize-ledger.mjs" <file.csv> [--date-column X] [--amount-column X] [--debit-column X] [--credit-column X] [--group-by X]`. Never total a ledger export by hand.
- `web.read` -> WebFetch.
- `web.search` -> WebSearch.
- `filesystem.read` / `filesystem.readSharedPath` -> Read.
- `git.log` / `git.status` / `git.diff` -> Bash (`git log`, `git status`, `git diff`).
- `filesystem.proposeWrite` -> show the exact diff and ask before editing any file.

## Memory

- [Career Direction](references/career-direction.md) — Curated goals go here.
- [Profile](references/profile.md) — Curated career facts go here.
- [Projects](references/projects.md) — Curated project facts go here.
- [Skills](references/skills.md) — Curated skills go here.
