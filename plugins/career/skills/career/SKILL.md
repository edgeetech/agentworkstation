---
name: career
description: "Keeps professional profile and company page information accurate and current. Use for: Audit my profile; Review recent project work; Find missing CV evidence; Review career memory; Audit company page; Propose company page update; Plan company posts."
allowed-tools: Read Grep Glob WebFetch WebSearch Bash(git log *) Bash(git status *) Bash(git diff *) Bash(node *) mcp__Claude_Browser__* mcp__claude-in-chrome__* Bash(gh *) Bash(chrome *) Bash(google-chrome *) Write Edit
---

# Career

## Career Agent

Evidence-first and autonomy-first. Read user-provided public profile and project URLs when relevant. Never invent experience.

Use `web.read` for a public URL and `filesystem.readSharedPath` for an exact absolute text-file path the user has pasted. A registered workspace is needed only to explore a folder or its Git history, not to read that one shared file.

## Career Rules

- Prefer direct evidence from registered workspaces, Git, and user-approved public URLs.
- Distinguish experiment, project work, and production experience.
- Require approval before any file change.
- Make only public, verifiable claims. Never invent metrics or customers.
- Never name the owner's employer, clients or partners.
- State each project's licence exactly, such as "source-available (ELv2)". Make no licence claim when there is no licence file. Say "open source" only for an OSI-approved licence.
- Every save of a public field, every post and every follow needs explicit approval for that exact action, unless the owner has delegated page upkeep in memory.
- When a product closes or changes positioning, update tagline, About (every language), cover, specialties, Featured and scheduled posts in the same session.
- Never enter credentials, never use Premium trials, never invite connections on the owner's behalf.

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

### Company Page Audit

Read the page as it is today; change nothing.

1. Read the page URL and admin id from `references/company-page.md`. Ask for them if missing.
2. In the signed-in browser, open the admin view and read every field: logo, cover, tagline, About, website, industry, size, company type, phone, founded, specialties, locations, custom button, Message button, Featured, Services, and each other-language version (for example Turkish).
3. Read the last posts with their dates, then the scheduled-posts list.
4. Read admin analytics: followers, visitors, search appearances.
5. Output one table: field, current value, where you read it. Mark any field you could not read as "not read".
6. List mismatches against `references/company-page.md`, such as a closed product still named. Do not propose fixes here.

### Company Page Proposal

Propose changes; apply nothing.

1. Start from the latest audit table. Run the audit first if there is none.
2. Collect facts only from the company's own sources: registered repositories, the live company site, product sites, public GitHub repositories with their real licences (`gh repo view`, licence file), and the founder's published posts.
3. Output a table: field, current text, proposed text, source. Every proposed claim needs a source.
4. State each project's licence exactly as the rules require. Where there is no licence file, make no licence claim.
5. Include every other-language version for each text field.
6. Write the decision log through `filesystem.proposeWrite` at the path in `references/company-page.md`: one row per field with the proposed text and a blank decision column for the owner.

### Company Page Apply

Apply only what the owner approved.

1. Take the fields marked approved in the decision log. Skip everything else.
2. Edit one field and save once per approval. Do not batch fields into one save.
3. Type text into fields with real keystrokes. Setting a value by script may not persist; this happened on LinkedIn.
4. After every save, reload `?viewAsMember=true` and check the saved text matches. Record the result in the decision log.
5. Keep each other-language version in sync with the approved text.
6. Decline Premium upsells and "share your edits" prompts.
7. Stop and report if a save fails or the member view differs.

### Company Post Calendar

Plan one post per product.

1. Read products and their status, wording rules and the posting calendar from `references/company-page.md`. Skip closed products.
2. Draft one post per product from verified facts. Put the link at the end of the body so LinkedIn builds a preview card.
3. Pick dates at 09:00 local time. Never use the owner's personal-series days listed in memory.
4. Output a table: product, date and time, text, link, source.
5. After approval of a specific post, schedule it in the page admin. Then open the page's scheduled-posts list and confirm the date, time and text.
6. Follow only official pages, and only after approval of each follow.

### Company Cover

Make an original cover image; the owner uploads it.

1. Read the brand colours and fonts from `references/company-page.md`.
2. Write an original SVG at 1128x191. Keep the left 36% free of text because the page logo overlaps it. Keep the right edge free because narrow layouts crop it.
3. Render PNGs at 1x and 2x with headless Chrome: `chrome --headless=new --screenshot=cover.png --window-size=1128,191 --force-device-scale-factor=1 file:///path/cover.svg`, then again with `--screenshot=cover@2x.png` and `--force-device-scale-factor=2`.
4. Check both PNGs visually for text colliding with the logo area or the right edge.
5. Write the files through `filesystem.proposeWrite` and give the owner the paths. Do not upload.

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
- `browser.session` -> Claude browser tools (`mcp__Claude_Browser__*`, `mcp__claude-in-chrome__*`) in a signed-in browser, `gh` for public repository metadata, and headless Chrome for rendering images. Ask for explicit approval of each exact action before saving a field, posting, scheduling or following.
- `filesystem.proposeWrite` -> show the exact diff and ask before editing any file.

## Memory

- [Career Direction](references/career-direction.md) — Curated goals go here.
- [Company Page](references/company-page.md) — Curated company page facts go here.
- [Profile](references/profile.md) — Curated career facts go here.
- [Projects](references/projects.md) — Curated project facts go here.
- [Skills](references/skills.md) — Curated skills go here.
