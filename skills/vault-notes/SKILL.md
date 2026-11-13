---
name: vault-notes
description: Conventions for writing and linking notes in the Obsidian vault. Use when creating, restructuring, or linking vault notes, and in learn mode.
---

# Vault notes

The vault is a permanent record of what you and the user worked out together. Write so a note
read in six months still makes sense without the conversation.

`assets/note-template.md` is the skeleton. Copy it rather than inventing structure per note.

## Before writing

1. Check what already exists. `find <vault> -name "*.md" | head -200` and grep for the topic
   before creating a note — duplicate half-notes are the main failure mode.
2. Prefer appending a section to an existing note over creating a new one.
3. Create a new note only for an idea you can name in a noun phrase.

## Structure

- Filename is the concept, not the date: `spaced-repetition.md`, not `2025-11-12.md`.
- Lowercase-hyphenated names, so wikilinks stay predictable.
- Frontmatter: `title`, `tags` (2-4, from the existing tag vocabulary — grep for
  `tags:` first rather than coining new ones), `created`, and `source` when the idea
  came from a specific text.
- One idea per note. Body starts with a one-paragraph statement of the idea, then detail.
- End with a `## Related` list of `[[wikilinks]]`.

## Linking

Link to a note only after confirming it exists — `ls` or `grep` for the filename. An invented
link is worse than no link: it looks like a claim and reads as a dead end.

Link in both directions when it is mutual. If A references B and B is about something adjacent,
add the reverse link in B; that is how the vault becomes a graph instead of a list.

## Understanding checks

When a note records something the user just learned, write the check alongside it:

```markdown
**Understood as:** <the user's own words, not yours>
**Still fuzzy:** <the specific piece that slipped>
**Test:** <one question that would expose the misconception>
```

Quote the user. A note that only contains the model's explanation records what the model said,
not what the user learned.
