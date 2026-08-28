---
status: rejected
type: RULE
tags: [architecture]
---

# DOCS-028: a package SPEC restates a fact its manifest owns

Paired with `.agents/tasks/completed/DOCS-028-a-spec-restates-a-fact-its-manifest-owns.md`.
Arising from [issue #2194](https://github.com/woojubb/robota/issues/2194).

## Problem

See the paired Task for the measurement. In short: the architecture map states its relationship to
package SPECs; SPECs state no relationship back, and 2 of the 7 layer claims they carried were already
false.

## Prior Art Research

Waived: the decision is which of this repository's own documents owns a fact, settled by this
repository's own rule (`learning-loop.md` § Contradiction Between Rules). No external product's
documentation bears on it. Recorded rather than left empty, per [research.md](../../rules/research.md).

## Architecture Review

**Alternatives.**

1. **Parse the prose claim and diff it against `package.json`.** Rejected by `learning-loop.md`:
   _"Prefer deleting the restatement to keeping both and checking them."_ It keeps two copies of one
   fact and adds a parser between them — the arrangement that produced the drift. It also makes the
   check argue about prose, which is where a check stops being falsifiable.
2. **Delete the Layer field entirely.** Rejected: the layer NAME is a classification the manifest does
   not carry, and it is genuinely the SPEC's to state. Only the dependency enumeration is a
   restatement.
3. **A sweep with no check.** Rejected on the repository's own recorded evidence — the rule that
   removal of an unconsumed surface is a product decision "already existed and was violated anyway",
   which is why `check-contract-disposition` exists. A sweep without a floor drifts back.
4. **Remove the restatement, point at the owner, and refuse a new one.** Chosen.

**Reachability.** The rule is reached from the two documents a SPEC author actually reads —
`spec-writing-standard` and `spec-template.md` — which previously made zero reference to the map.

**Falsifiability.** The decision is an exported pure predicate, tested directly. ARCH-101's
`regression-red-proof` failure is the precedent: a condition living inline in `main()` was covered by
tests that exercised only the shared predicate, so deleting the condition broke nothing.

## Completion Criteria

- **TC-01** No SPEC's Layer field enumerates dependencies; all 7 point at the owner instead.
- **TC-02** `spec-manifest-restatement` refuses a Layer field naming a workspace package, and is wired.
- **TC-03** Its finder is classified fail-closed and its declared size is registered and tested.
- **TC-04** `spec-writing-standard` and `spec-template.md` name the map and say who owns what.
- **TC-05** Three mutants die; the suite is green restored.
- **TC-06** `pnpm harness:scan` green.

## Test Plan

See the paired Task. The load-bearing evidence is TC-05 — without a killed mutant, a new scan's green
is the accidental-green shape issue #2181 catalogues.

## Evidence Log

| Claim                                        | Verified at                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GATE-APPROVAL                                | Standing owner instruction, current conversation: "레포 속 규칙대로 모두 너가 판단하고 레포 속 규칙을 기반으로 선택하기 어려운 것만 나에게 요청하며 모든 작업을 진행하며 마지막까지 완료해줘" — decide by the repository's rules and escalate only what the rules cannot settle. This item is settled by `learning-loop.md` § Contradiction Between Rules, quoted above, so it is inside the delegated class. |
| 7 SPECs stated a layer in prose              | `grep -rl '^- \*\*Layer\*\*' packages/*/docs/SPEC.md` → 7 of 58                                                                                                                                                                                                                                                                                                                                               |
| Two were false                               | `agent-builtin-providers` and `agent-provider-openai`, compared to their `package.json` dependencies                                                                                                                                                                                                                                                                                                          |
| Five were copy-pasted                        | identical sentence across the five leaf providers                                                                                                                                                                                                                                                                                                                                                             |
| The map states the relationship one way only | `ARCHITECTURE-MAP.md` ¶3; `spec-writing-standard` and `spec-template.md` → zero references to the map                                                                                                                                                                                                                                                                                                         |
| The check can go red                         | mutants: predicate neutered → 3 red; `=` → `+=` on the counter → 1 red; governed-tree guard removed → 1 red; restored → 8 green                                                                                                                                                                                                                                                                               |
| Scans pass                                   | `pnpm harness:scan` → 141 passed, 2 skipped, 0 failed                                                                                                                                                                                                                                                                                                                                                         |

## User Execution Test Scenarios

Not applicable — documentation fields, an authoring standard, a template comment and one harness scan;
no runnable user-facing product behaviour changes. The reason is recorded per
`.agents/tasks/README.md`, and the applicable checks including the mutation proof are in the Test Plan.

### [REJECTION] — 2026-08-29

The documented implementation was already delivered by PR #2204 at merge commit
`918ba647036b700e249d9b301287e5431c00931b`, and PR #2257 subsequently carried the record into its
current lifecycle at merge commit `12a4ecd1b741199c989ded9f956bfaa0e212b9f8`. Current focused tests
and scans pass, so no implementation remains. This approved plan did not record a valid
GATE-IMPLEMENT through GATE-COMPLETE history before that delivery; it is therefore rejected rather
than promoted to done, without manufacturing retrospective gate verdicts.
