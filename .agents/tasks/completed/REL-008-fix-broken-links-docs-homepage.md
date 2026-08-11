---
title: 'REL-008: Fix broken links in content/README.md docs homepage'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: high
urgency: soon
area: content/README.md
depends_on: []
---

## Background

`content/README.md` (the VitePress docs homepage) links to pages that do not exist
in the `content/` docs layer:

- `./showcase/` — does not exist in `content/`
- `./roadmap.md` — does not exist in `content/`
- `/compare/` — exists only in `apps/www` (the marketing site), not in the docs site

Users following these links from `robota.io/docs` get 404 errors immediately after landing
on the homepage. This creates trust damage disproportionate to the trivial nature of the fix.

Source: pre-release PM audit P1.5 (2026-05-25).

## Change Required

For each broken link, choose one:

- **`./showcase/`**: Remove the link until a showcase page exists, or create a placeholder
  `content/showcase/index.md`.
- **`./roadmap.md`**: Remove the link until a roadmap page exists, or create a placeholder
  `content/roadmap.md` with a brief "Coming soon" message.
- **`/compare/`**: Either remove or change to an absolute URL pointing to the marketing site
  `apps/www` comparison page (if publicly deployed).

## Acceptance Criteria

- No dead links from `content/README.md`
- `pnpm docs:build` (or equivalent) completes without link warnings for these paths
