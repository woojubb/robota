---
title: 'HARNESS-104: the spec public-surface scan stops counting at the first subheading, so a grouped Public API table reads as entirely undocumented'
status: done
created: 2026-08-17
completed: 2026-08-18
priority: high
urgency: now
area: scripts/harness, packages/*/docs/SPEC.md
depends_on: []
issue: https://github.com/woojubb/robota/issues/1765
---

# HARNESS-104: a check that cannot PASS on correctly-structured input

> Filed as HARNESS-104, not the HARNESS-093 the issue names: that ID is already held by
> `completed/HARNESS-093-owner-scenario-record-cli-was-deleted.md`. Reusing it would have made a
> containment note resolve silently to an unrelated closed item.

## Problem

`scripts/harness/check-spec-public-surface.mjs:95-116` holds a single `inPublicApi` boolean while
walking a SPEC line by line. Any heading that does not itself match `/public api/i` turns the flag
off — including a `###` subheading nested **inside** `## Public API Surface`. A SPEC that groups its
public surface into subsections therefore has every table after the first subheading skipped, and the
scan reports those exports as undocumented.

## Evidence

Measured 2026-08-17 by running today's parser and a hierarchical one over all 22 packages carrying a
`spec-surface-baseline.json` entry:

| Package                       | Baseline | Seen now | Seen if hierarchical | Newly visible |
| ----------------------------- | -------- | -------- | -------------------- | ------------- |
| `@robota-sdk/agent-framework` | 157      | 144      | 191                  | +47           |
| `@robota-sdk/agent-plugin`    | 29       | 0        | 32                   | +32           |
| `@robota-sdk/agent-command`   | 140      | 0        | 29                   | +29           |
| `@robota-sdk/agent-core`      | 147      | 38       | 67                   | +29           |
| `@robota-sdk/agent-session`   | 2        | 46       | 75                   | +29           |
| `@robota-sdk/agent-transport` | 9        | 0        | 17                   | +17           |
| `@robota-sdk/dag-framework`   | 8        | 0        | 13                   | +13           |
| **Total**                     | **567**  | **334**  | **530**              | **+196**      |

Four packages have their entire Public API table read as empty. `agent-command` carries a frozen
baseline of 140 undocumented exports while the scan cannot see a single row of its table.

`packages/agent-core/docs/SPEC.md` shows the shape directly: `## Public API Surface` at line 178,
`### Core` at line 194 closing it 16 lines later, and 20+ subsections after that invisible.

## Why it matters more than a wrong number

- **The ratchet fires on the wrong thing.** The baseline is a count, so adding one correctly-documented
  export trips the scan. That is how this was found: ARCH-031 added
  `DEFAULT_BACKGROUND_PERMISSION_POLICY`, documented it, and had to add a temporary standalone table to
  get past the scan.
- **It is the mirror of a check that cannot fail** — the class HARNESS-098 already tracks. In both
  directions the printed number carries no information about the thing it names, and gets believed.
- **It punishes the recommended structure.** `spec-writing-standard` asks for a Public API table, and
  grouping a large one by section is what the four biggest packages do.

## Direction

Make the section test hierarchical: once inside a heading matching `Public API`, stay inside until a
heading of the **same or shallower** level appears. Re-derive every package baseline in the same
change and report the per-package delta — whatever survives is real debt that was invisible until now,
which is the actual value of the fix. Remove the ARCH-031 workaround table from `agent-core`'s SPEC.

## What landed, measured

The fix arrived in two parts, because the first one left a defect of the same shape one level down.

| Revision            | Total frozen | `agent-core` | What changed                                                                                                                  |
| ------------------- | ------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `2d3b2c028`         | **567**      | —            | before any fix — matches this item's evidence table                                                                           |
| `7669851c5` (#1804) | **482**      | 134          | the hierarchical section test: once inside a `Public API` heading, stay inside until a heading of the same-or-shallower level |
| `9dcb5da66` (#1830) | **441**      | **93**       | the OUTERMOST match owns the extent                                                                                           |
| HEAD                | 441          | 93           | current; re-derived delta across all 20 packages is **0**                                                                     |

**126 phantom entries** were removed from the frozen debt in total.

### The second part, and why it was not caught by the first

`7669851c5` re-assigned `sectionDepth` on EVERY heading matching `/public api/i`. So a nested
`### … Public API …` inside `## Public API Surface` LOWERED the boundary from 2 to 3, and the next
sibling `###` then closed the whole `##` section — the original defect, one level down.

`agent-core` is the only package whose SPEC has that shape: `### Abort Classification Public API
(CORE-027)` is followed by `### Schema (CORE-015)`, and every table below was invisible. The parser
saw **69 of 143** documented identifiers. That is why the second part moved only `agent-core`'s
number while every other package's was already correct.

Fixed in `9dcb5da66` by `sectionDepth = sectionDepth || level` — a match INSIDE an open section is
part of it, not a new one.

### The ARCH-031 workaround, removed

`packages/agent-core/docs/SPEC.md` carried a standalone table at the top of `## Public API Surface`
holding ten rows, with an HTML comment saying it existed so a genuinely new export could be seen past
the parser defect. The defect is gone, so the workaround is not just redundant — it contradicts the
document's own structure by keeping ten exports out of the sections that own them.

It could not simply be deleted: all ten rows were **unique**, not duplicates of rows below, so
deleting would have removed the documentation for ten real exports and raised the undocumented count
by ten. Each row was moved to the subsection that owns it:

| Export(s)                                                                                                                                                                           | Moved to                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `DEFAULT_BACKGROUND_PERMISSION_POLICY`                                                                                                                                              | `### Permissions`, beside `resolvePermissionByPolicy`                                            |
| `clearRegisteredToolProfiles`, `getToolPermissionProfile`                                                                                                                           | `### Permission Argument Registry Public API (CORE-030)`, beside `registerToolPermissionProfile` |
| `closeObjectSchemas`                                                                                                                                                                | `### Schema (CORE-015)`                                                                          |
| `resolveModelCapabilities`, `modelDeclaresCapability`, `resolveModelCapability`, `IProviderStructuredOutputCapability`, `TStructuredOutputMechanism`, `TStructuredOutputProvenance` | `### Provider Capabilities`, which gained a table                                                |

The Permission Argument Registry section's prose pointed AT the workaround table ("see its row in the
Public API Surface table above") and is repointed, so the removal does not leave a dangling
reference.

## Test Plan

`scripts/harness/__tests__/check-spec-public-surface.test.mjs` holds both halves, each red-proved
against the code it describes:

- the hierarchical cases from `7669851c5`, including a `####` nested two levels deep and a sibling
  `###` that correctly ENDS the section — the terminating half is what stops the fix over-counting
  tables outside the surface section;
- `(CORE-035) a NESTED "Public API" subheading does not shrink the section`, red-proved by reverting
  the one-token change (`sectionDepth = level`), which fails 2 of 15.

For this change specifically, the invariant is that the workaround removal moves rows rather than
losing them: `publicApiIdentifiers` sees **144 identifiers before and after**, and the scan's own
per-package delta across all 20 packages is 0. `pnpm harness:scan` — 123 passed, 2 skipped.

## User Execution Test Scenarios

**Not applicable.** This is a harness check and a SPEC document; no product surface changed, and
`backlog-execution.md` says not to invent a scenario for a governance-only change. The verification
that matters is engineering verification and is recorded in the Test Plan above — which is also the
rule's own instruction for this case.

The one thing a reader might mistake for user-facing is the SPEC edit; it documents the same ten
exports it documented before, in the sections that own them, and the identifier count proves nothing
was added or lost.

## Blockers

None.
