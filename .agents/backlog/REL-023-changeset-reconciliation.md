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

## Progress

**Triage half DONE** (chore/rel-023-changeset-triage). Findings and actions:

- The "74 dormant" framing was a misread of changesets **pre-mode retention**: 53 of the 73
  changesets (74 files incl. README) were already CONSUMED by `changeset version` runs — they are
  listed in `.changeset/pre.json` `changesets[]` and their bumps are in the published 3.0.0-beta
  line (last npm publish: 3.0.0-beta.79, 2026-07-06). Pre-mode keeps consumed files on disk until
  `pre exit`. All 53 deleted (incl. the empty `every-aliens-pump.md`); their release history lives
  in the REL-022 root `CHANGELOG.md`.
- The 20 unconsumed changesets all describe post-beta.79-publish, never-published work
  (merged 2026-07-07..07-11): REMOTE-002..010, ARCH-PROVIDER Stages A–E, INFRA-031, DATA-006,
  SCREEN-003, INFRA-032. Kept 15 as-is; merged REMOTE-003+006 into one net-behavior entry
  (`remote-command-source-and-policy.md` — the deny-by-default gate never appeared in a published
  version); corrected 3 (remote-002/009/010) whose bump target `@robota-sdk/agent-web-ui` was
  dissolved by GUI-006 (#1141) → retargeted to `agent-transport-webrtc-web` / `agent-remote-client`.
  Result: 19 pending changesets.

## Remaining (the owner-reviewed half — NOT done)

1. **`changeset version` review PR** (owner reviews per-package changelog output in isolation).
   That PR must FIRST make `changeset` runnable at all:
   - remove dissolved `@robota-sdk/agent-web-ui` from `.changeset/config.json` `fixed[]` —
     `pnpm changeset status` currently fails config validation on it (config.json was read-only
     for the triage PR); verified clean with that one-line fix applied;
   - optionally prune the 53 now-ghost names from `.changeset/pre.json` `changesets[]`
     (mechanically harmless — changesets filters by name — but precedent: ARCH-PROVIDER-006
     pruned 37 dead pre.json entries).
2. **publish.md go-forward rule**: changesets are consumed at every publish, never stockpiled.
3. Note: work merged after beta.79 without any changeset (e.g. GUI-006/007, SEC-001, SELFHOST
   series, CORE-025/026, ARCH-004) is NOT covered by the 19 pending entries — the version PR
   should assess whether those need fresh changesets before the next publish.

## Test Plan

The version PR's generated changelogs are reviewed against the REL-022 CHANGELOG; publish dry-run green.
