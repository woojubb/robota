---
title: 'CLI-078: `robota eval` composes its own provider outside the product profile — and so does the subagent runner factory, before the fold'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2443#issuecomment-5455751753
created: 2026-07-25
priority: medium
urgency: soon
area: packages/agent-cli
depends_on: [ARCH-005]
---

# CLI-078: two collaborators are constructed outside the one assembly point

## Problem

After the ARCH-005 S2 collapse, `robota`'s main surfaces assemble through `assembleProduct`, but
`packages/agent-cli/src/eval/eval-command.ts` still composes its own provider outside the profile
(found by the S2 conformance review). So there are two provider-construction paths in one product.

**There are three.** Measured at `a0b7891ea` while testing whether issue #2048's four claims were one
problem:

- **`eval` builds its own path.** `eval-command.ts:100-107` calls `createProviderFromSettings` →
  `createAgentRuntime`, with `providerDefinitions: createDefaultProviderDefinitions()` at :104,
  unconditionally. (The original citation above was `:89`; the construction is the same one, moved.)
- **`createRobotaSubagentRunnerFactory` is called at `cli.ts:233` — nineteen lines BEFORE
  `assembleProduct` at :252** — carrying its own `providerConfig: { ...providerSettings, model: modelId }`
  and a `reproduction:` block. `backgroundTaskRunners` (:232) is constructed there too. Both are then
  handed to serve-mode (:341-342) and print-mode (:421-422) **directly, around the assembly.**

These two are one cause, which is why this record holds both: **a collaborator constructed outside the
single assembly point cannot receive what assembly folds in.** Fixing one and leaving the other
reproduces the pattern registered as issue #2314 — a fix landing on one of several paths carrying the
same value, and reading as complete.

## What ARCH-109 did and did not do

ARCH-109 found a child-process subagent rebuilding the default provider set. Its fix,
`subagent-provider-reproduction.ts`, made the recipe hold session-wide — and `cli.ts:250-251` records
exactly that: _"that parenthesis was true of this process and false of its children until
`subagent-provider-reproduction.ts` made it hold session-wide."_

**ARCH-109 reproduced the recipe on the far side of the bypass and left the bypass standing.** The
call at :233 is the same construction, relocated out of `cli.ts` under the file-size floor — out of the
file is not into the right place. And the reproduction never reached `eval`:
`git log --all -S createRobotaSubagentComposition -- packages/agent-cli/src/eval/` returns nothing,
where the same query without the pathspec returns the ARCH-109 commits.

## The seam comment is part of what has to change

`cli.ts:274` calls the `buildRobotaRuntimeOptions` result "the kernel's RUNTIME SEAM — every surface
below binds to THIS one result." That is true of `commandModules`, `agentDefinitions` and `toolOptions`,
which do pass through it. It is false of the two collaborators handed around it.

This cost a wrong measurement: reading the comment produced a verdict that the modes bind
post-assembly, corrected only by checking construction order. **A document's self-description diverging
from what the document contains** is the same object as issue #2048's summary line claiming a direction
its own evidence line refutes (see CLI-080). In both, the true version was cheaper to reach than the
false one — construction order, and the next paragraph. Whoever fixes this must correct the comment, or
the next reader stops where that reading stopped.

## What

Decide and record: either route `eval` and the runner factory through the product profile like the
other surfaces, or document them as deliberately separate shell paths (with the reason — e.g. eval
needs a provider configuration the interactive profile should not carry). Silence is the thing to
avoid: an undocumented second path is how the composition root grew back last time.

**Scope the fix by asking what the fold would have to accept.** If `assembleProduct` cannot take a
subagent runner factory without the caller building it first, that constraint is the real one and it
decides the size of this item.

## Priority

Raised to `medium` / `soon` on the structural bypass, which is confirmed above. **Not raised further,
deliberately:** ARCH-109's measured harm was two specific things — a replay parent whose children called
live with a real key, and caller-supplied definitions failing to resolve in the child. **Neither is
measured for the eval path**, and this is not ranked on the assumption that a structural sibling carries
the same harm. If the eval path is found to carry the key exposure, it goes higher **on that
measurement rather than on the resemblance.**

## Test Plan

If routed: `eval` still passes its existing suite and the provider it receives is the one the profile
resolves (assert equality). For the runner factory, the equivalent assertion is that the factory the
modes receive is the one assembly produced — a construction-order test, since the defect is invisible to
a value comparison when both paths happen to resolve the same provider. If documented-as-separate: a
comment at each call site + a line in `agent-cli/docs/SPEC.md` stating the exemption and its reason.

## User Execution Test Scenarios

Unwritten, with the reason recorded here as Stage 1 requires — not left blank. This record's
disposition is undecided: routing through the profile and documenting a separate path deliver
different user-observable behavior, and one of them delivers none. Writing a scenario now would
invent one for work whose shape is not chosen.

**This reason is temporal and does not survive the choice.** It makes writing impossible _now_, and
expires the moment the disposition is decided — at which point this section must be filled, before
implementation. A reason that has expired reads exactly like one that has not, so it is said here
explicitly: if the disposition is on record and this section is still empty, the exception no longer
applies and the omission is a defect, not an exception.
