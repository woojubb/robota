---
title: 'REL-023: reconcile 74 dormant .changeset files before the next npm publish'
status: todo
created: 2026-07-25
priority: medium
urgency: before-next-publish
area: .changeset/
depends_on: []
---

# REL-023: dormant changeset reconciliation

## Problem

74 unconsumed `.changeset/*.md` files have accumulated (REL-022 audit). The next `pnpm changeset version`
will consume ALL of them at once, producing a chaotic wall of per-package CHANGELOG entries spanning months
and potentially wrong bump levels for the beta line.

## What

Before the next npm publish: triage the 74 files — collapse superseded/duplicate entries, verify bump levels
against what actually shipped (the generated root CHANGELOG.md from REL-022 is the cross-check), then run
`changeset version` in a dedicated PR so the owner reviews the per-package changelog output in isolation.
Document the go-forward rule in publish.md: changesets are consumed at every publish, never stockpiled.

## Test Plan

The version PR's generated changelogs are reviewed against the REL-022 CHANGELOG; publish dry-run green.
