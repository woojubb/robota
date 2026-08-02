---
title: 'DAG-004: eight dag-cli commands open-code the DAG import adapter, so an invalid definition still enters through them'
status: todo
created: 2026-08-02
priority: medium
urgency: next
area: packages/dag-cli
depends_on: [DAG-002]
---

# DAG-004: the import boundary has one owner and eight bypasses

## Problem

DAG-002 gave the two on-disk DAG formats a single import adapter,
`dagDefinitionFromParsedFile` (`packages/dag-builder/src/parsed-dag-file.ts`), which rejects a shape
that is neither format and rejects a definition whose `status` is outside `TDagDefinitionStatus`.

Three surfaces were converted to it: `/workflows run`, `/workflows validate`, and `dag runs submit`.
**Eight `dag-cli` commands still open-code the same
`isWorkflowFileFormat` / `isLegacyDefinitionFormat` branch and assign the legacy-format object
straight through as `IDagDefinition` with no check at all.** A file carrying `status: 'active'` —
the exact value DAG-002 exists to eliminate, and one that `dag-cli node`'s example generator emitted
until DAG-002 fixed it, so such files are on real disks — still enters cleanly through every one of
them.

## Evidence

Found by review on PR #1605, which correctly called the SPEC's "the one place the workflow-file
format is read" an overclaim. The wording has been narrowed; the coverage gap is this item.

Open-coded sites (each `parsed as IDagDefinition` with no validation):

- `packages/dag-cli/src/commands/run.ts:986-990`, `:1051-1055`, `:1114-1118` (three)
- `packages/dag-cli/src/commands/view.ts:90`
- `packages/dag-cli/src/commands/cost.ts:249`
- `packages/dag-cli/src/commands/explain.ts:217`
- `packages/dag-cli/src/commands/benchmark.ts:375`
- `packages/dag-cli/src/commands/fix.ts:288`
- `packages/dag-cli/src/studio/http-server.ts:58`

They are not a straight substitution: most read a `.dag.robota.json` companion first
(`tryReadCompanion`), and each renders its own exit code and message, which is why DAG-002 converted
only the sites it was already touching rather than sweeping mid-change.

## Why this is foundational (or not)

**LOCAL, but repeated.** No single site is deep; the defect is that a boundary with one owner has
eight bypasses, so the owner's guarantees are not the system's guarantees. That is the same
"registered ≠ reached" shape the repo keeps meeting, one level down: the adapter exists and is
correct, and most callers do not go through it.

## Direction

Route every site through `dagDefinitionFromParsedFile`, passing the companion where one is read.
`tryReadCompanion` and the per-command message rendering stay where they are — only the
branch-and-cast is replaced.

`readDagFileArg` (`packages/dag-cli/src/commands/read-dag-file-arg.ts`) is the shape to follow: it
returns a discriminated result rather than throwing, so a caller renders an exit code without a
try/catch. A companion-aware sibling would serve the remaining eight.

## Test Plan

- **Required red-first regression, per site:** feed each command a definition file carrying
  `status: 'active'` and assert it is reported. Against current code every one of them accepts it.
- One case per command asserting an unrecognised shape is reported rather than passed on.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies.** Each of these is a user-facing command.

- **Prerequisites:** a built `robota`/`dag` CLI and a definition file with `status: "active"` — the
  shape `dag-cli node`'s example generator produced before DAG-002.
- **Steps:** run each affected command against that file.
- **Expected observable result (after the fix):** each names the invalid status and exits non-zero.
- **Expected observable result (before the fix, for contrast):** each proceeds as if the file were
  valid.
- **Cleanup:** delete the scratch file.
- **Evidence (fill in after implementation):** the command output for each site.
