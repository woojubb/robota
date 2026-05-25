---
title: 'REL-006: Add beta disclaimer to docs homepage and root README'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: critical
urgency: immediate
area: content/README.md, README.md
depends_on: []
---

## Background

`content/README.md` (the VitePress docs homepage) presents Robota as production-ready
with no beta notice. The npm badge shows `3.0.0-beta.67` but the label reads "latest" —
most developers will not parse this as "pre-release software."

The root `README.md` also has no beta mention.

The only beta callout in the docs is on `content/getting-started/README.md`, one click away.

The `dist-tags.latest` for all packages points to `3.0.0-beta.67`, meaning
`npm install @robota-sdk/agent-cli` (without `@beta`) installs the beta.
This is an intentional choice but must be disclosed prominently.

Source: pre-release PM audit P1.4 (2026-05-25).

## Change Required

**`content/README.md`:** Add a callout block near the top (below the hero section):

```
> **Beta Software**: Robota is currently in active beta (3.0.0-beta.x). The API is stabilizing
> but breaking changes may occur between minor versions. See the [changelog](./changelog/)
> for migration notes. Stable 1.0 is targeted for [quarter].
```

Copy the pattern already used in `content/getting-started/README.md`.

**`README.md` (root):** Add a brief beta badge or note in the header section.

## Acceptance Criteria

- `content/README.md` has a visible beta/pre-release notice above the fold
- Root `README.md` mentions beta status
- The notice links to `CHANGELOG.md` or the changelog page
