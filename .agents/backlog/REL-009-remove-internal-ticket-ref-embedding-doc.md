---
title: 'REL-009: Remove internal ticket reference from content/guide/embedding.md'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: high
urgency: soon
area: content/guide/embedding.md
depends_on: []
---

## Background

`content/guide/embedding.md` contains a line referencing an internal backlog ticket:

> "After CORE-002, `additionalTools` is available on `createSession`"

This is a working-notes reference that means nothing to external developers and signals
that the documentation is internal notes, not finished public content.

CORE-002 has been completed and merged (as of 2026-05-25). The `additionalTools` field
is now available on `createSession`. This line should either be removed or rewritten
as a plain API fact.

Source: pre-release PM audit P1.6 (2026-05-25).

## Change Required

Find and remove (or rewrite) any line in `content/guide/embedding.md` that references
internal ticket IDs (`CORE-002`, `PLG-*`, `REL-*`, etc.).

Replace with a plain statement if the feature is implemented:

> `additionalTools` is available on `createSession` — pass an array of `IToolWithEventService`
> instances to extend the built-in tool set.

Search the entire `content/` directory for similar leaked ticket references:

```bash
grep -rn 'CORE-\|PLG-\|REL-\|CLI-\|UX-\|PM-\|TOOL-' content/
```

## Acceptance Criteria

- No internal ticket IDs appear in any file under `content/`
