---
title: 'DOCS-028: a package SPEC restates a fact its manifest owns'
issue: https://github.com/woojubb/robota/issues/2194
status: in-progress
created: 2026-08-23
priority: high
urgency: now
area: packages/*/docs/SPEC.md, .agents/skills/spec-writing-standard, .agents/templates, scripts/harness
depends_on: []
---

# DOCS-028: a package SPEC restates a fact its manifest owns

## Problem

`.agents/specs/ARCHITECTURE-MAP.md` states its relationship to package SPECs in one direction —
"Package `docs/SPEC.md` files remain the owner contracts for each package … without duplicating
package-level contract truth". Nothing states the other direction, and the consequence is measurable.

7 of 58 package SPECs stated a layer in prose, and the sentence carried the package's dependency set
with it. **Two were false:**

| package                   | SPEC claimed                                                      | manifest declared                                |
| ------------------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| `agent-builtin-providers` | "Layer 1 (depends on `agent-core` only among framework packages)" | `agent-core` + four provider siblings            |
| `agent-provider-openai`   | the same sentence                                                 | `agent-core`, `agent-provider-openai-compatible` |

Five of the seven were the identical sentence, copy-pasted. It was true for the leaf providers and was
never true for the aggregator, which has depended on four siblings since ARCH-PROVIDER-002 created it.

Disclosure: STRUCT-011 renamed that package and moved its SPEC without noticing the false claim.

## Why this is the same defect as the one that made ARCH-100's contradiction invisible

A package's layer had three possible homes and no owner: prose in some SPECs, ARCH-101's
machine-readable table in the map (for one family), and `project-structure.md` § Layered Assembly
Architecture. Nothing compared any pair. That is why a merged owner map could state a target the
Interface Package Rule forbade and nothing brought them into contact — no package SPEC referenced
either document.

## Decision

The repository's own rule settles the shape. `learning-loop.md` § Contradiction Between Rules:
_"Prefer deleting the restatement to keeping both and checking them."_

So the fix is **not** a check that parses the prose claim and diffs it against the manifest — that
keeps two copies and puts a parser between them, which is the arrangement that produced the drift.
The restatements are removed, the SPEC points at the owner, and a check refuses a new one.

ARCH-101 established the same shape one family over: one declaration, one reader, no second copy.

## Plan

- [x] Rewrite the `**Layer**:` field in all 7 SPECs: keep the layer NAME (a classification the manifest
      does not carry), drop the dependency enumeration, point at the owner.
- [x] Add `spec-manifest-restatement` — refuses a Layer field that names a workspace package.
- [x] State the relationship in `spec-writing-standard` and `spec-template.md`, which made **zero**
      reference to the architecture map.
- [x] Wire the scan, classify its finder, and register its declared size.

## Test Plan

- `scripts/harness/__tests__/check-spec-manifest-restatement.test.mjs` — 8 cases against the exported
  predicate, not through `main()`: a guard reachable only through `main()` is a guard no test can
  falsify (ARCH-101).
- **Three mutants killed, proven not asserted.** Predicate never reports → 3 red. Counter accumulates
  (`=` → `+=`) → 1 red. Governed-tree guard removed → 1 red. Restored → 8 green.
- The two rows in the fixture are the real claims that were false in the tree.
- `pnpm harness:scan` → 141 passed, 2 skipped, 0 failed.

## What the check does NOT cover, stated so its green is not read as wider than it is

Only the structured `- **Layer**:` field. A SPEC's prose elsewhere may still restate a dependency set,
and this cannot see it. That is deliberate: a SPEC legitimately states BOUNDARIES ("must never depend
on the framework"), which are constraints the manifest does not own, and no pattern separates a
boundary claim from a dependency restatement without reading intent. A wider check would fail on
correct documents, which gets suppressed rather than obeyed.

## User Execution Test Scenarios

Not applicable — documentation fields, an authoring standard, a template comment, and one harness
scan. No runnable user-facing product behaviour changes. Per `.agents/tasks/README.md` a
documentation/harness change records the not-applicable with its reason; the checks that do apply,
including the mutation proof, are in the Test Plan.
