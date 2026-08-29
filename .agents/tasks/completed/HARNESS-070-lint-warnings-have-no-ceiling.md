---
title: 'HARNESS-070: lint warnings have no ceiling, so a rule set to warn enforces nothing'
status: skipped
created: 2026-08-03
priority: medium
urgency: next
area: scripts/harness, eslint.config
depends_on: []
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2251#issuecomment-5460833334
returned_to_issue_secondary: https://github.com/woojubb/robota/issues/2255#issuecomment-5460833419
---

# HARNESS-070: 1927 warnings, and nothing objects to 1928

## Problem

`pnpm lint` reports **1927 warnings and 0 errors** (measured 2026-08-03), and passes. It runs without `--max-warnings`, so a
rule configured as `warn` has no effect on any gate: a change may add as many warnings as it likes and
every check stays green. The rules currently in that state include
`@typescript-eslint/no-unused-vars`, `complexity` and `max-lines-per-function`.

The practical consequence is that a rule set to `warn` is documentation, not enforcement — while
reading like enforcement, because it is configured, it fires, and its output scrolls past in CI.

## Evidence

Measured on PR #1607 (ARCH-013 stage 1), which extracted three option surfaces into their own
modules. Each extraction left the imports that had backed the moved code behind:

- `packages/agent-framework/src/interactive/interactive-session-init.ts` — `NOOP_TERMINAL`,
  `FileSessionLogger`
- `packages/agent-transport-tui/src/TuiInteractionChannel.ts` — `IAIProvider`,
  `IToolWithEventService`, `TPermissionMode`, `IInteractiveSession`, `IInteractiveSessionStore`,
  `ITransportRegistryView`, and earlier eleven more from `@robota-sdk/agent-framework`

Nineteen dead imports across one PR. `no-unused-vars` flagged every one of them and nothing failed.
(The count is dominated by other rules — 747 of the warnings are `ban-types` on `unknown` — so the
delta a single PR contributes is not separable from the total without a per-rule freeze. That is an
argument FOR per-rule freezing, not against the ratchet.)
Two review rounds each named ONE of them; the rest were found by a sweep afterwards. A reviewer
reading warnings is not a gate — it is a person doing a mechanical job by hand, which is the shape
this repository keeps replacing.

## Why this is foundational (or not)

**LOCAL in cause, broad in blast radius.** Nothing about the lint configuration is architecturally
wrong; the gap is that no gate reads its output. It belongs to the same family as the other ratchets
here (`file-size`, `spec-public-surface`, `contract-cast`, `option-reachability`): a number that may
fall and must never rise.

## Direction

A warning-count ratchet, following the pattern the repository already uses four times:

- Freeze the current total (and, preferably, the per-rule totals — a change that removes ten
  `complexity` warnings while adding ten `no-unused-vars` ones should not read as neutral).
- A rise fails and names the rules that grew. A fall demands a re-freeze in the same change.
- Run it from `pnpm lint` or as a registered scan, not as a separate thing to remember.

The alternative — promoting rules from `warn` to `error` — is not landable at 1927 and would be
suppressed rather than obeyed, which is why the ratchet shape is preferred here.

Not decided: whether the per-rule breakdown is frozen from the start or added once the total is
falling. Starting with per-rule is cheap and prevents the swap above; starting with the total is
simpler.

## Test Plan

- **Required red-first regression:** add one unused import, and assert the scan FAILS naming
  `@typescript-eslint/no-unused-vars`. Against current code `pnpm lint` exits 0.
- Red-first: a removed warning without a re-freeze must fail with the re-freeze instruction.
- Red-first: a swap — one rule's count falling and another's rising by the same amount — must fail if
  per-rule freezing is chosen, and this case documents the choice either way.
- Fail-closed: a run that produced no lint output at all is an error, not a pass over zero warnings.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Does not apply.** This governs the repository's own build gates and delivers no user-facing
behaviour change. The evidence is the scan's own red-proof plus a CI run showing it registered.

## Resolution

This record is superseded and split between the canonical warning-reduction queue (#2251) and the
ratchet-semantics investigation (#2255). The current repository has a warning ceiling, but the
remaining rule-by-rule reduction and measured-output semantics are owned by those issues. The local
record is archived as skipped so it does not compete with the canonical implementation work.
