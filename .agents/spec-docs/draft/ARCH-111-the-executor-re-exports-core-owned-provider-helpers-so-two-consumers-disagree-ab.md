---
status: draft
type: RULE
tags: [architecture, ownership, providers]
---

# ARCH-111: one function, two exporting packages, two consumers that disagree

## Problem

`normalizeProviderConfig` and `createProviderFromConfig` are owned by `agent-core` and re-exported by
`agent-executor`. Measured at `c1c3ac079`, one product imports the same function from both:

```
agent-framework/src/command-api/provider/provider-factory.ts:2   createProviderFromConfig  ← agent-executor
agent-framework/src/command-api/provider/provider-merge.ts:1     normalizeProviderConfig   ← agent-executor
agent-product/src/assemble-product.ts:2                          createProviderFromConfig  ← agent-core
```

Both compile. Issue #2051 describes consumers _preferring_ the facade; measurement shows the product
doing both at once, which is a different and worse thing — **two consumers holding different answers
to who owns the symbol, with nothing able to notice.**

## Prior Art Research

Waived: the question is which of this repository's own packages owns two of its own functions, and
whether a re-export created by its own prior change (ARCH-PROVIDER-003) still has a reason to exist
under its own release policy. No external product's documentation bears on it. The evidence that
decides it is the re-export's stated purpose and this repository's ruling on backward compatibility,
both read directly below.

## Solution (draft direction)

Remove the re-export; point the two `agent-framework` imports at `@robota-sdk/agent-core`.

**Why the reason for the duplicate is gone.** `agent-executor/src/providers/provider-factory.ts:14`
says it exists _"so existing `@robota-sdk/agent-executor` consumers are unaffected"_, and
ARCH-PROVIDER-003 line 68 says _"re-exports from the new location (no consumer break)"_. That is a
backward-compatibility guarantee. **This repository does not make one** — the owner's standing ruling
is that legacy is not a consideration before release.

**The ground is deliberately not "few consumers".** The owner has ruled that a public interface is not
made private or removed for having one caller or none — only when it is genuinely unnecessary or does
not fit the design. **The argument here is the second one:** the symbol has one owner, the duplicate
name exists solely for a guarantee this repository does not make, and its presence is precisely what
lets two consumers disagree about the owner. Import count is evidence of the effect, not the reason.

**Why it is mechanical**, checked rather than assumed: `agent-framework` already depends on
`@robota-sdk/agent-core` and already imports from it in **156 files**. Repointing two lines adds no
dependency edge and changes no behaviour.

## Completion Criteria (draft)

- `agent-executor` no longer exports `normalizeProviderConfig` or `createProviderFromConfig`, asserted
  at the type level rather than by `grep`, so a returning export fails at compile time.
- `agent-framework`'s provider suites pass with the imports repointed — proving the two names were one
  function and the facade added nothing.
- **Positive control**: `agent-core` still exports both, so a suite proving the executor dropped them
  cannot pass against a workspace that lost them entirely.
- `agent-executor/docs/SPEC.md` stops listing exports the package no longer has.
- `tsgo --noEmit` clean workspace-wide — a missed consumer is a build failure here, not a silent
  fallback, so the compiler is the real coverage check.
- `pnpm harness:scan` green.

## Test Plan

See Completion Criteria; the type-level export assertion and the positive control are the two that
carry it. The compiler covers consumer reach, which is the part a test enumerating known call sites
would get wrong if one were missed.

## User Execution Test Scenarios

Not authorable, and left unwritten with the reason recorded rather than filled with a placeholder.
This item deletes a duplicate export and repoints two imports at the same function: `robota`'s
behaviour, output and exit codes are identical before and after. That identity is the acceptance
criterion, not a gap in it.

**This reason does not expire** — it is a property of what the item delivers, not of an undecided
disposition.

## Evidence Log

- 2026-08-25 — Measured at `c1c3ac079`. Three import sites, two packages, one function; all compile.
- 2026-08-25 — `agent-framework/package.json` lists `@robota-sdk/agent-core`; `agent-framework/src`
  imports from it in 156 files. The change adds no edge.
- 2026-08-25 — Re-export's stated purpose read at `provider-factory.ts:14` and at
  ARCH-PROVIDER-003:68. Both are consumer-compatibility, which the owner's ruling removes.
- 2026-08-25 — Split from issue #2051's other half, filed as issue #2347: injecting an environment
  resolver changes `resolveEnvReference`, a published `agent-core` export named in two SPECs, so it
  carries its own decision under `backlog-execution.md` § Agent Decision Authority.
- 2026-08-25 — **GATE-APPROVAL: owner sign-off obtained.** Asked whether to remove the re-export,
  keep it while unifying the imports, or defer; the owner selected **"승인, 재수출 제거"** — approve,
  remove the re-export. A peer session's instruction to take this half set the ORDER of work and was
  explicitly not treated as this approval.
- 2026-08-26 — Implemented: re-export removed from `provider-factory.ts`, `providers/index.ts` and
  `src/index.ts`; `agent-framework`'s two imports repointed at `agent-core`; the executor SPEC's
  export list and its "pure utilities" paragraph corrected.
- 2026-08-26 — **The compiler found the consumer I had not counted.** `tsgo --noEmit` failed on
  `agent-executor/src/providers/provider-factory.test.ts`, which imported both names from the module
  under test. That is the coverage property the record claimed: a missed consumer is a build failure,
  not a silent fallback.
- 2026-08-26 — Two `OrgPolicyParseError` errors appeared in `agent-cli` and were **not** this branch:
  they reproduce with the change stashed, and `pnpm build:deps` clears them. The stale-`dist`
  advisory the scan suite prints is exactly this case, and following it was what kept a pre-existing
  cross-package error from being read as a branch defect.
- 2026-08-26 — **The surface assertion was vacuous on the first attempt and the mutation is what
  showed it.** Written as `import type * as Executor from '@robota-sdk/agent-executor'`, it resolved
  through `dist/` and described the last build: re-adding the re-export produced **no type error at
  all**. Repointed at `../index.js` — the package's own entry source — and the same mutation now
  fails with two `TS2322`s. A surface assertion that reads a built artifact is the vacuous-green shape
  this repository exists to remove, and it was one line away from shipping.
- 2026-08-26 — A second mutation placed at `providers/index.ts` also produced no error, correctly:
  `src/index.ts` gates the surface with an explicit named list, so the sub-barrel cannot widen it. The
  mutation had to be placed at the real surface to be a mutation of the property under test.
- 2026-08-26 — `sdk-public-surface` reported the executor's surface **shrank** 2 → 1 and asked for a
  re-freeze in the same change; done, with the reason recorded at the constant.
- 2026-08-26 — `agent-executor` 105, `agent-framework` 1559, `agent-product` 18, `agent-core` 1198
  tests pass. `pnpm run typecheck` exit 0 workspace-wide. `pnpm harness:scan` 143 passed, 0 failures.
