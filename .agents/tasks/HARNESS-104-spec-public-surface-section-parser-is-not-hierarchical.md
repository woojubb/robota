---
title: 'HARNESS-104: the spec public-surface scan stops counting at the first subheading, so a grouped Public API table reads as entirely undocumented'
status: in-progress
created: 2026-08-17
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

## Blockers

None.
