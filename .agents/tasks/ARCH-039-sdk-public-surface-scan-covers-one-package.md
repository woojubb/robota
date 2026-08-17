---
title: 'ARCH-039: check-sdk-public-surface only reads agent-framework, so the published surface of every other package is ungoverned'
status: todo
created: 2026-08-17
priority: medium
urgency: soon
area: scripts/harness, packages
depends_on: []
---

# ARCH-039: the SDK public-surface scan covers one package

Filed out of issue #1764 (ARCH-037). That issue raised four contract-hygiene items; three were
refuted against the code and one was fixed, and the issue was closed on that disposition. But the
issue's own stated alternative to its item 1 — **widen `scripts/harness/check-sdk-public-surface.mjs`
beyond `agent-framework`** — was never the thing that got refuted. It is the tractable form of the
concern that produced the issue, and it survives.

## The gap

`check-sdk-public-surface.mjs` governs `agent-framework`'s published surface. Every other package
that publishes to npm — `agent-core`, `agent-executor`, `agent-command`, the `agent-interface-*`
family, the provider packages, `agent-subagent-runner` — has no equivalent floor. A pass-through
re-export placed in the wrong package, or a symbol published from a package that should not own it,
is visible in exactly one package's diff and invisible in all the others.

The refutation of #1764's item 1 is what makes this worth filing rather than dropping. That item
proposed removing three `agent-core` re-exports from `agent-interface-transport`; doing so forced
`agent-transport-protocol` to import `agent-core` directly, which `.agents/project-structure.md`
forbids for that package. So the re-exports are the interface hub the layering requires — they are
correct. What remains true is the reason someone looked: **nothing tells you whether a given
re-export is the required hub or an accident**, in any package but one.

## Why this is its own item and not a line in #1764

Widening the scan will almost certainly surface findings across several packages at once. Some will
be genuine misplacements, and some will be the same shape as the three re-exports above — structural
and correct. Sorting them is design work with a per-package answer, which is a spec's job, not a
follow-up commit on a closed issue.

Expect the ratchet pattern this repository already uses: freeze what exists per package, require new
work to comply, and shrink the frozen set deliberately. A widening that fails the whole tree on day
one gets switched off.

## Measured — TC-02, 2026-08-18

Run before designing the widening, because "several packages at once" is a guess and a per-package
count is an input. Measured over every **publishable** package (31 of them; `private: true` excluded)
by walking each package's own `exports` source roots and following local re-export edges — the same
graph the real scan builds for `agent-framework`.

Two shapes were counted: `export *` in the public graph (which the scan forbids outright, on the
grounds that a star export makes owner boundaries unauditable) and re-exports of another
`@robota-sdk/*` package from the public graph (the pass-through shape).

| Package                            | Public files | `export *` | Cross-pkg re-exports | Re-export sources                         |
| ---------------------------------- | ------------ | ---------- | -------------------- | ----------------------------------------- |
| `agent-command`                    | 88           | 27         | 1                    | agent-framework                           |
| `agent-provider-openai-compatible` | 28           | 21         | 0                    |                                           |
| `agent-core`                       | 114          | 20         | 0                    |                                           |
| `agent-framework` (governed)       | 161          | **0**      | 11                   | agent-executor, agent-interface-transport |
| `agent-plugin`                     | 44           | 8          | 0                    |                                           |
| `agent-provider-gemini`            | 10           | 8          | 0                    |                                           |
| `agent-provider-anthropic`         | 5            | 4          | 0                    |                                           |
| `agent-provider-openai`            | 12           | 4          | 0                    |                                           |
| `agent-provider-bytedance`         | 4            | 3          | 0                    |                                           |
| `agent-transport`                  | 13           | 2          | 2                    | agent-core/testing                        |
| `agent-interface-transport`        | 25           | 1          | 1                    | agent-core                                |
| `agent-executor`                   | 17           | 0          | 1                    | agent-interface-transport                 |
| `agent-session`                    | 17           | 0          | 1                    | agent-interface-transport                 |
| `agent-session-analytics`          | 5            | 0          | 1                    | agent-interface-transport                 |
| `agent-transport-tui`              | 7            | 0          | 1                    | agent-interface-tui                       |

**15 of 31 publishable packages** carry at least one governed shape: **98 `export *`** and **19
cross-package re-exports**.

Spot-checked rather than trusted: `agent-framework` has zero `export *` anywhere under `src/`, and
`agent-command` has exactly 27 — both match the walk. (`agent-core` shows 22 in `src/` against 20 in
the public graph, i.e. two sit outside the published surface, which is the walk doing its job.)

### What the numbers decide

1. **The governed package is the only one with zero `export *`.** That is the floor working where it
   is applied and absent everywhere else — it is the evidence for this item, not an argument about it.
2. **A day-one widening fails ~15 packages at once**, so the ratchet the record predicted is required,
   not optional. Freeze per package at today's value; new work complies; shrink deliberately.
3. **`agent-command` is the largest single item** (27 star exports, an `index.ts` that is nothing but
   `export *` lines). It is likely its own burn-down item rather than part of the widening.
4. The 19 cross-package re-exports are the shape needing per-package judgement — #1764's refutation
   showed `agent-interface-transport`'s `agent-core` re-exports are the layering's required hub, and
   four packages re-export `agent-interface-transport` in what looks like the same hub role. The scan
   must be able to express "this one is the hub", which is the design question TC-01 names.

Measurement script: not committed — it is a one-shot count, and the widened scan replaces it.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                           | Notes                                                                      |
| ----- | ----------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| TC-01 | Unit test   | Fixture packages with a correct hub re-export and a misplaced one         | The scan must separate the two, which is the whole design question         |
| TC-02 | Unit test   | Run the widened scan over the real tree and record the per-package counts | The measurement that decides whether a ratchet is needed and at what value |
| TC-03 | Unit test   | Tighten a package's frozen value by one and assert the scan fails         | Red proof — a ratchet nobody proved can fail is not a ratchet              |
| TC-04 | Unit test   | `agent-interface-transport`'s three `agent-core` re-exports stay green    | Pins the refutation from #1764 so a later widening cannot silently undo it |
| TC-05 | CI pipeline | `pnpm harness:scan`, `pnpm typecheck`, `pnpm test`                        | Whole-repository gate for a published-surface change                       |
