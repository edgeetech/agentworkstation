# Draft Bilingual Post

## Inputs

- An approved topic brief and factual local sources.
- The curated voice profile and editorial preferences, or the voice profile the human approved earlier in this conversation.
- Intended Turkish and English audiences.
- When known, the target site's content folder or publish target.

## Process

1. Build a shared fact and intent outline from approved sources. When the human supplies a fact brief, for example about their own product, it is the only source for claims about that subject; do not top it up from search results or inference.
2. Draft the primary-language article naturally in the documented voice.
3. Draft the second language from the shared intent and facts, not by translating sentences. Adapt idiom, rhythm, examples, headings, and transitions for that audience. If its opening paragraphs map one-to-one onto the primary language's sentences, rewrite them.
4. Cross-check both versions for factual equivalence, unsupported claims, accidental omissions, and literal-translation artifacts.
5. When a target content folder is known, read its content schema (for example an Astro `content.config.ts`) and the frontmatter of one published article in each language. Shape both drafts as entries for that site: matching frontmatter fields and filename slugs, the translation link between the pair, and the schema's draft or unpublished flag switched on. Leave out fields such as a hero image rather than inventing an asset.
6. Mark unresolved factual, editorial, or localization decisions for human review.

## Revisions

- Apply review notes to the same draft files in place and keep the parts the notes do not touch.
- Check every note against the approved sources before applying it. When a note adds a claim the sources do not contain, such as a new date, limit, or commitment, treat it as the human's own unsourced statement: list it under "Unsourced claims from review" in your reply so the human can confirm it, and never edit the sources yourself to make it look sourced.
- Reply with a short change list mapped to the notes, including any note you did not apply and why.

## Output

Separate Turkish and English drafts, a shared fact checklist, source references, and a short note describing intentional localization differences. Produce proposals only.
