---
title: 'REL-012: Write 3.0.0 migration guide for developers upgrading from v2'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: medium
urgency: before-stable
area: content/guide/
depends_on: []
---

## Background

`CHANGELOG.md` documents 20+ breaking changes in the 3.0.0 release:

- Type renames (e.g., interface/class renames)
- Class renames
- Removed packages (`agent-sdk`, `agent-sessions`, `agent-provider-anthropic`, etc.)
- Changed import paths

Any developer upgrading from v2.x has no documented migration path. The v2-era content
at `content/v2.0.0/` is an internal development guide, not an upgrade guide for users.

`content/quickstart.md` references `apps/starter-nextjs` but instructs users to clone the
full monorepo — which also needs to be addressed.

Source: pre-release PM audit P1.3 (2026-05-25).

## Change Required

Create `content/guide/migration.md` covering:

1. **Package renames**: which old packages map to which new packages
2. **Import path changes**: concrete before/after examples
3. **API renames**: key class/interface/function renames with code examples
4. **Removed features**: what was removed and what replaced it
5. **Breaking config changes**: if any

Source data: `CHANGELOG.md` 3.0.0 section.

Link from:

- `content/README.md` (in the beta disclaimer callout)
- `content/getting-started/README.md` (at the top, for upgraders)

## Acceptance Criteria

- `content/guide/migration.md` exists and covers all breaking changes in `CHANGELOG.md`
- The file is linked from the docs homepage and getting-started page
