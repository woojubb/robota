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

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                           | Notes                                                                      |
| ----- | ----------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| TC-01 | Unit test   | Fixture packages with a correct hub re-export and a misplaced one         | The scan must separate the two, which is the whole design question         |
| TC-02 | Unit test   | Run the widened scan over the real tree and record the per-package counts | The measurement that decides whether a ratchet is needed and at what value |
| TC-03 | Unit test   | Tighten a package's frozen value by one and assert the scan fails         | Red proof — a ratchet nobody proved can fail is not a ratchet              |
| TC-04 | Unit test   | `agent-interface-transport`'s three `agent-core` re-exports stay green    | Pins the refutation from #1764 so a later widening cannot silently undo it |
| TC-05 | CI pipeline | `pnpm harness:scan`, `pnpm typecheck`, `pnpm test`                        | Whole-repository gate for a published-surface change                       |
