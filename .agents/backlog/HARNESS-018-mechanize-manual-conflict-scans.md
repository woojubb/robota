---
title: 'HARNESS-018: Mechanize the manual Conflict-Scan / deprecated-marker checks into run-all-scans'
status: todo
created: 2026-06-27
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# Mechanize manual conflict / deprecated scans

## What

Two documented checks exist only as **manual `rg` blocks or prose**, never wired into
`pnpm harness:scan` (the 30-scan `run-all-scans.mjs` runner):

1. **AGENTS.md "Conflict Scan Commands" (`AGENTS.md:149-154`).** A human is expected to run
   `rg "any/unknown may|fallback to|temporary workaround"` and
   `rg "main agent|sub-agent|parent-agent|child-agent"` across `.agents/` + `AGENTS.md`.
   Nothing runs these in CI. Add `scan-conflict-markers.mjs` that greps the same corpus and
   fails on a hit (with an allowlist seam for legitimate occurrences), then register it in the
   `run-all-scans.mjs` SCAN array.
2. **"No deprecated" rule (memory feedback `feedback_no_deprecated`).** Prose-only. Add
   `scan-deprecated-markers.mjs` scanning shipped `src/` for `@deprecated` / `deprecated`
   markers (this is a pre-1.0 unpublished project — deprecated is banned, delete or migrate).
   Register it in the SCAN array.

Follow the established scan conventions: no early-exit, full summary at the end (HARNESS-011),
and an explicit, documented allowlist rather than silent skips.

## Why

A check that only runs when a human remembers to type `rg` is not a gate. Folding these into
`run-all-scans.mjs` makes them CI-enforced like the other 30 scans, with no new manual step.

## Done When

- `scan-conflict-markers.mjs` and `scan-deprecated-markers.mjs` exist, follow the
  no-early-exit/summary convention, and have allowlist seams.
- Both are registered in `run-all-scans.mjs` and run under `pnpm harness:scan`.
- `pnpm harness:scan` passes on the current tree (allowlist seeded for existing legitimate
  hits, each annotated with why).
- A deliberate `fallback to` / `@deprecated` insertion makes the scan fail.

## Test Plan

- `pnpm harness:scan` → both new scans appear in the summary and pass.
- Insert a banned marker into a scanned file → the relevant scan fails with the file:line.
- Confirm the AGENTS.md "Conflict Scan Commands" block now points at / is covered by the
  mechanized scan (update the prose to reference the script).

## User Execution Test Scenarios

1. Run `pnpm harness:scan` → the conflict-marker and deprecated-marker scans run as part of
   the suite; introducing a banned phrase fails the suite. Evidence: _to fill._
