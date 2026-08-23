---
title: 'ARCH-107: move peer and handoff contracts to the session-mobility owner'
status: in-progress
created: 2026-08-23
priority: high
urgency: now
area: packages/agent-cli, packages/agent-framework, packages/agent-interface-session-mobility,
  packages/agent-interface-transport, packages/agent-transport-protocol,
  packages/agent-transport-webrtc, scripts/harness
depends_on: []
---

# ARCH-107: move peer and handoff contracts to the session-mobility owner

Registered as GitHub issue https://github.com/woojubb/robota/issues/2111.
Parent tracker: issue #2068. Owner map: ARCH-100. Layer rule: ARCH-101, corrected by ARCH-106.
Wave 3. Sixth of seven leaves.

## Problem

The peer-messaging and handoff contract families — moving MESSAGES between live sessions, and
AUTHORITY over a session to another machine — are the last non-transport families in
`agent-interface-transport`.

## Existing Evidence

Measured on `origin/develop` @ `22152ef9d`.

- **21 symbols across 3 modules**: `peer-message-contracts`, `handoff-contracts`,
  `session-mobility-contracts`.
- **4 consumer packages, 24 statements, 0 MIXED.** The smallest leaf of the programme, and the only
  one with no mixed statement to split.
- `peer-message-contracts` and `handoff-contracts` each name a type from `agent-interface-session`;
  `session-mobility-contracts` composes the other two.

## The layer prediction, recorded BEFORE the work — and it was WRONG a second time

ARCH-106 stated a rule abstractly — _a package's layer is the HIGHEST of what it holds_ — and its own
author then predicted `agent-interface-transport` would reach layer 0 and measured layer 2. This leaf
re-ran that test **with the rule in hand**, predicting before any module moved or any guard ran.

|                                    | predicted | measured  |     |
| ---------------------------------- | --------- | --------- | --- |
| `agent-interface-session-mobility` | 2         | 2         | ✅  |
| `agent-interface-transport`        | **0**     | **2**     | ❌  |
| every other owner                  | unchanged | unchanged | ✅  |

**The rule failed its second test, with its own author applying it deliberately.**

The prediction enumerated what transport would hold as _"`transport-adapter`, `transport-config`,
`channel-contracts`, `admission`"_. Those four are clean — each imports only `@robota-sdk/agent-core`.
But the package also holds a **`/testing` subpath**, and `testing/index.ts` imports
`IInteractiveSession` for the `createTestInteractiveSession` double. That is a real dependency on
`agent-interface-session` at layer 1, so transport is layer 2.

**The miss is the same class as ARCH-106's: an incomplete enumeration of what the package holds.**
ARCH-106 reasoned from what would stop being held; ARCH-107 enumerated contract modules and forgot a
published subpath. The rule says "take the maximum of what it holds" and does not say what counts as
_held_ — and both failures are in that gap, not in the maximum.

## Consequence for the pending amendment (issue #2218)

The wording must change before it lands. "What it holds" has to name **every published surface** — the
entry, every subpath, and the doubles — not just the contract modules a reader is thinking about.

That is exactly what the pre-registered prediction was for: had the rule been landed first and this
leaf run afterwards, the wording would have shipped and this failure would have looked like an
author's error rather than the rule's.

## A second finding: the two guards disagreed, and only one was right

Declaring transport at the predicted layer 0 produced:

- `check-dependency-direction.mjs` — **FAILED**: `agent-interface-transport (layer 0) → agent-interface-session (layer 1) runs UPWARD`
- `interface-family-owner` — **PASSED**

The module-level scan cannot see it, because `testing/index.ts` is not a mapped contract module and
its import is therefore outside the projection. The manifest-level guard has the complete view here.
`interface-family-owner`'s green was correct about module edges and silent about the package.

## Completion Criteria

- [ ] `agent-interface-session-mobility` exists at layer 2 with the three modules.
- [ ] `agent-interface-transport` is declared at layer 0 — its name finally describes its contents.
- [ ] No mobility symbol is exported from `agent-interface-transport`'s barrel.
- [ ] `pnpm harness:scan` exit 0 and `pnpm harness:verify-like-ci` green.

## Test Plan

- The existing suites of all 4 consumer packages, unchanged.
- Workspace `pnpm typecheck`; full harness scan and CI mirror.

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

**Layer 2, three modules, deps `{agent-core, agent-interface-session}`** — confirmed.

**The second failed layer prediction, and the reason this leaf matters beyond its diff** (the
prediction was pre-registered before measuring; recorded here 2026-08-24). It predicted
`agent-interface-transport` would reach layer 0 and measured 2, exactly as ARCH-106 had. ARCH-106
computed the maximum over what the package would _stop_ holding; this leaf computed it over the
contract modules and forgot the published `/testing` subpath.

**The rule states an AGGREGATION — take the maximum — and does not state the DOMAIN it aggregates
over.** Two failures with the same cause indict the wording rather than the author, which is what a
pre-registered prediction is for. Issue #2218 is the amendment.
