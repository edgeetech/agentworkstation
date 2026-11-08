# Company Page Proposal

Propose changes; apply nothing.

1. Start from the latest audit table. Run the audit first if there is none.
2. Collect facts only from the company's own sources: registered repositories, the live company site, product sites, public GitHub repositories with their real licences (`gh repo view`, licence file), and the founder's published posts.
3. Output a table: field, current text, proposed text, source. Every proposed claim needs a source.
4. State each project's licence exactly as the rules require. Where there is no licence file, make no licence claim.
5. Include every other-language version for each text field.
6. Write the decision log through `filesystem.proposeWrite` at the path in `memory/company-page.md`: one row per field with the proposed text and a blank decision column for the owner.
