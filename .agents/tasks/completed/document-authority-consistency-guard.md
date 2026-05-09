# Document Authority Consistency Guard

## Status

Completed.

## Created

2026-05-09

## Completed

2026-05-09

## Source Backlog

`.agents/backlog/document-authority-consistency-guard.md`

## Recommendation

Implement the first version as an advisory harness warning, not a hard failure.

Reason:

- Document-authority drift is important, but markdown intent has a high false-positive risk.
- The rules already define authority; the first automation should surface likely violations without
  blocking unrelated work.
- Changed-file analysis is safer than scanning every historical document and retroactively warning
  on old design notes.

## Completed Changes

- Added `scripts/harness/check-document-authority.mjs`.
- Added `pnpm harness:scan:document-authority`.
- Wired the warning report into `pnpm harness:scan` and harness consistency required scripts.
- Added tests for misplaced architecture plans, design-owned contracts without owner docs, and valid
  package source + SPEC updates.

## Test Strategy

This is a harness governance change. Verification covers the warning classifier directly, then
confirms root harness scan integration.

## Verification

- `pnpm exec vitest run scripts/harness/__tests__/check-document-authority.test.mjs`
- `pnpm harness:scan:document-authority`
