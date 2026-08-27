---
title: 'ARCH-108: narrow the transport owner and prove the omnibus surface is gone'
status: done
created: 2026-08-23
completed: 2026-08-23
priority: high
urgency: now
area: apps/remote-signaling, packages/agent-cli, packages/agent-interface-session,
  packages/agent-interface-session-mobility, packages/agent-interface-transport,
  packages/agent-session, packages/agent-transport, packages/agent-transport-http,
  packages/agent-transport-mcp, packages/agent-transport-protocol, packages/agent-transport-tui,
  packages/agent-transport-webrtc, packages/agent-transport-ws, scripts/harness
depends_on: []
---

# ARCH-108: narrow the transport owner and prove the omnibus surface is gone

Registered as GitHub issue https://github.com/woojubb/robota/issues/2113.
Parent tracker: issue #2068. **The closure leaf** — the last of seven, and the one that must prove the
migration finished rather than move anything.

## Problem

Issue #2113 asks for three things. Measured on `origin/develop` @ `4ed80522b`, they are not the same
kind of work, and one of them is already done.

## Existing Evidence

**1. There is no omnibus left to delete.** The transport barrel exports **39 symbols**: 38 declared by
its own four modules (`transport-adapter` 18, `transport-config` 10, `channel-contracts` 8,
`admission` 2), plus `TActionResponse` — a documented named exception under ARCH-037, not omnibus
residue.

**The criterion is satisfied by predecessors.** ARCH-103 through ARCH-107 removed the facade one
family at a time; there is nothing left for this leaf to delete. Recorded as measured rather than
manufacturing a deletion to earn the checkbox.

**2. The absence must be proved at the RESOLUTION level, not the declaration level.** A symbol can be
absent from a barrel and still reachable through a subpath, a deep import, or an `export *` in another
file — and issue #2221 makes the last one concrete. Proof run over three surfaces: the transport
package's own source, every consumer in the workspace, and the **built** `.d.ts`.

The built check nearly failed as evidence: `dist/node/index.d.ts` was **stale**, older than
`src/index.ts`, so the first run measured an out-of-date artifact and passed. Rebuilt and re-run.
_A check whose oracle is a layer you did not measure is a check of that layer._

**3. `/testing` and the layer are one question, not two.** `agent-interface-transport` is layer 2
because `testing/index.ts` imports `IInteractiveSession` for `createTestInteractiveSession`. There is
no version of this leaf that moves the double and leaves the layer, and none that reaches layer 0
without moving it.

- The double's consumers: **9 packages, 42 statements, 6 MIXED** (mixed with
  `runTransportLifecycleConformance`, which stays).
- `runTransportLifecycleConformance` doubles the transport lifecycle contract and stays put.

## The rule decided the `/testing` question

`.agents/project-structure.md:314` states the convention: **`contracts→agent-interface-*, doubles→owner
/testing`**. `createTestInteractiveSession` doubles `IInteractiveSession`, owned by
`agent-interface-session`, so the double belongs in that package's `/testing`.

Recorded because the conclusion was reached by argument first and checked against the rule second, and
the check could have gone the other way. It did not: the rule says the same thing, and the rule is why
it moves.

The 42 consumer statements are a migration cost, not an architectural input — consistent with the
owner's 2026-08-23 ruling that in-repo consumer count is not evidence about a `packages/` surface.

## Completion Criteria

- [x] `createTestInteractiveSession` lives in `agent-interface-session/testing`; consumers updated.
- [x] `agent-interface-transport` declares **layer 0**, and both guards agree.
- [x] Resolution-level absence proof passes over source, consumers and the **freshly built** types.
- [x] The omnibus finding is recorded as satisfied-by-predecessors with its measurement.
- [x] `pnpm harness:scan` exit 0 and `pnpm harness:verify-like-ci` green.

## Test Plan

- The existing suites of all 9 consumer packages.
- The absence proof, re-run after a build rather than against whatever `dist/` happened to hold.
- Two independent checks of the same outcome: the double lives with its contract, AND the package
  declares layer 0 with the scans agreeing. If those ever disagree, something is wrong that neither
  shows alone.

## User Execution Test Scenarios

This task delivers no runnable user-facing behavior, so the rule is satisfied by this reasoned
not-applicable entry rather than by scenarios.

**The reason first recorded here was false, and is corrected rather than deleted (2026-08-24).** It
read "no change to any runtime value, signature or shipped surface". The decomposition moved **15
runtime values**, not only types, and four of them — `readAssistantReplies`, `readLastAssistantText`,
`readToolCalls`, `readErrors` — are exported from the published
`@robota-sdk/agent-interface-transport@3.0.0-beta.79` tarball and now live in
`agent-interface-session`, which is not on the registry (`npm view` → E404). So the shipped surface
did change.

**Why scenarios are still not required.** The rule's trigger is runnable user-facing _behavior_.
Every consumer inside this workspace was rewired in the same change, so nothing a user can run
against this repository behaves differently. What the surface change reaches is the **registry**, and
that is a release-configuration problem rather than a property of this task: the next publish would
ship a transport without those four symbols and no published package that owns them. Issue #2260
owns it. Recording that here is part of the reason — the consequence was measured and handed to an
owner, not waved past.

## Footprint, declared and measured

`area:` was written as two packages before the work and measured **13 workspaces** after. The gap is
recorded rather than quietly corrected, because it is a scheduling input, not bookkeeping: a peer lane
reading that field would have been told this leaf was safe to run beside anything outside those two.

The real number was never unknown — this record's own Existing Evidence says **9 consumer packages, 42
statements, 6 mixed**, measured before implementation. It was in the prose and not in the field that
gets parsed, and **a declaration made where nothing reads it is not a declaration.**

Three of the 13 were outside even that 9, each a different way a footprint grows after it is declared:
`agent-interface-session-mobility` took documentation for contracts this leaf did not move;
`scripts/harness` holds the two tests that recorded the facts this leaf changed, and a leaf that
changes a measured fact touches every test that pinned it; `apps/remote-signaling` lost a dependency
rather than gaining one, which is invisible to any view asking what a change ADDS.

The generalisable part: for a leaf that moves symbols, the package set is not knowable at assignment
time, but the SYMBOL set is. Declaring the symbol lets the consumer set be derived on demand instead
of trusted from an author's enumeration.

## Outcome

All five criteria met; the full evidence, including two guard defects this leaf found in its own
instruments, is in the spec-doc's Evidence Log. The short form:

`agent-interface-transport` now imports `@robota-sdk/agent-core` and nothing else, across both
published entries, and is declared **layer 0** — the target it was predicted to reach twice before it
did. `deps` and `interface-family-owner` both accept the row, and a third, unrelated graph corroborated
it: the package's build tier fell 3 → 1 from the same edge removal, measured by code sharing nothing
with the layer parser.

**The two failed predictions are the more useful deliverable.** ARCH-106 computed the layer over what
the package would STOP holding; ARCH-107 computed it over the contract modules and forgot a published
subpath. Both computed a maximum over too small a domain, because the rule states the AGGREGATION and
not the DOMAIN it aggregates over. That is a defect in the rule's wording, and issue #2218 amends it —
which is what a pre-registered prediction is for: a second failure indicts the rule rather than the
author.

The same subpath was missed a third time, by this leaf's own absence proof, which read one of the two
published `.d.ts` entries. A check written after the ARCH-107 lesson repeated the ARCH-107 mistake.
Repaired by deriving its corpus from `package.json` `exports` rather than naming a path.

Filed on the way through: issue #2228 — `check-spec-public-surface.mjs` accepts a comment saying an
export is NOT present as proof that it is. It reported 2 phantom SPEC rows where comparing against the
built types found 6.

## Verification against the tree (2026-08-24)

Every criterion above was **measured against `develop` @ `81a4ab97c`**. They are recorded here and
left **unticked**: the spec document has not passed its gates, so ticking them would claim a
completion the pipeline has not granted. The measurement is evidence for a later gate, not a
substitute for one. The shared measurements, run once for all six leaves:

| Owner            | Symbols declared | Still reachable through transport's built surface |
| ---------------- | ---------------- | ------------------------------------------------- |
| execution        | 60               | 0                                                 |
| command          | 21               | 0                                                 |
| analytics        | 7                | 0                                                 |
| session          | 91               | 0                                                 |
| session-mobility | 21               | 0                                                 |

`agent-interface-transport` declares `@robota-sdk/agent-core` and nothing else, at layer 0. Checked
against the BUILT `.d.ts` of both published entries rather than the source barrel, because a
source-level check cannot see what a re-export chain publishes.

**Layer 0, four modules, deps `{agent-core}` across both published entries** — confirmed, and this is
the row the program existed to reach.

The full evidence is in this record's Outcome and Footprint sections and in the spec-doc's Evidence
Log; it is not repeated here. What belongs in a closure note is what the leaf found in its own
instruments: the absence proof read **2 of 6** built artifacts before being widened, having already
missed the `/testing` subpath once — the same surface that had refuted ARCH-107's prediction, missed
a second time by a check written after that lesson.

Filed from this leaf: issue #2228, issue #2233, issue #2236, issue #2248, issue #2249.

## Result

Delivered by PR #2244 (`c1dd93768`) on 2026-08-23. A 2026-08-28 reconciliation re-ran
`scan-interface-family-owner` and `check-dependency-direction`; both exited 0 after checking 22
contract modules and four manifest edges. Transport currently depends only on `agent-core`, both
published entries remain covered, and the projected graph is legal and acyclic. This Task is
complete; the paired planning document is rejected separately because its gate evidence and the
implementation landed together instead of through a pre-implementation planning checkpoint.
