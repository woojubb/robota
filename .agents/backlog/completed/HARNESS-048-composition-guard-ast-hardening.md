---
title: 'HARNESS-048: composition-neutrality guard — close the destructure/alias/bracket evasions'
status: done
created: 2026-07-25
completed: 2026-07-25
priority: medium
urgency: soon
area: scripts/harness
depends_on: [ARCH-005]
---

# HARNESS-048: the pure-fold guard is line-regex, and evadable

## Problem

`scripts/harness/scan-composition-neutrality.mjs` is the mechanical coupling that makes the L129
carve-out safe — the L129 relaxation explicitly holds ONLY while these guards hold. ARCH-005 S2's
conformance review planted a probe file in `packages/agent-product/src` containing ALL of the
following and the scan still printed `composition-neutrality scan passed`:

```ts
const { id } = profile; if (id === 'robota') …           // destructured identity equality
const alias = profile.id; if (alias.startsWith('acme'))  // aliased string predicate
globalThis['process'].env['HOME']                        // bracket form of the banned identifier
const proc = process; proc.env['HOME']                   // aliased process
table[profile['id']]                                     // computed identity index
```

Also uncaught: `await import('node:fs')` (the import regex requires `from|import` + whitespace +
quote) and any member access split across lines. The destructured/aliased identity form is the most
likely ACCIDENTAL one — i.e. the one a future contributor hits without intent.

Two smaller gaps: the failure line records which dependency was found but the reporter drops it
(`:62-66`), and `compositionNeutrality` covers only `packages/agent-product` — `agent-capability-pack`,
an equally pure published contract package, is unscanned.

## What

Move the guard to an AST-based check (or at minimum: ban bare `process` / bracket member forms inside
`agent-product/src`, track simple aliases/destructures of `profile.id`/`.agentName`, and catch dynamic
`import()`). Print the offending dependency/identifier in the finding. Extend the scan target set to
`agent-capability-pack`.

## Test Plan

Red-first: every evasion listed above becomes a fixture that FAILS before the fix and PASSES after
removal; the existing four caught forms must keep failing (no regression); the real tree stays clean.

- `scripts/harness/__tests__/scan-composition-neutrality.test.mjs` — the guard's own suite.
- `pnpm harness:test` — the whole harness script suite (no sibling scan regressed).
- `pnpm harness:verify-like-ci` — the CI mirror (harness-self-test, format-check, scan-suite on a
  built tree, typecheck).

## User Execution Test Scenarios

Not applicable — this is a harness-internal governance mechanism (a scan script + its config entry).
It delivers no runnable user-facing behavior: no CLI command, TUI action, browser flow, or public SDK
surface changes. The verification evidence is in `## Test Plan` and `## Outcome` below.

## Outcome (2026-07-25)

**Done.** The guard is now AST-based (TypeScript compiler API — already a workspace devDependency, no
new parser dep) instead of line-regex based.

**Parsing approach.** Each `src/` file is parsed with `ts.createSourceFile(..., setParentNodes: true)`
and walked with `ts.forEachChild` — purely syntactic, no type checker, so it stays fast and needs no
program/tsconfig. Two syntactic resolutions close the whole evasion class at once:

1. an **alias map** (`const proc = process` → `proc.env` resolves to `process.env`; `const a =
profile.id` → `a` resolves to `profile.id`), plus destructured `id` / `agentName` bindings tracked
   as identity aliases even when the source object is not statically resolvable; and
2. **static bracket → dot normalisation** (`globalThis['process']` → `globalThis.process`,
   `profile['id']` → `profile.id`).

Forbidden identifiers are matched as a **path prefix** on the resolved access path, reporting only the
outermost access so one read is one finding. Imports are read from every form the syntax offers —
static `import`/`export … from`, `import type`, `import x = require()`, `require()`, and dynamic
`import()`. Comments need no special-casing: the parser produces no nodes for them. Alias resolution
is deliberately scope-free (over-approximating): the guard may flag a shadowed name, but it must never
MISS a real one.

**Red → green, per evasion** (all pinned as fixtures in the guard's test file):

| Evasion                                           | Before | After                         |
| ------------------------------------------------- | ------ | ----------------------------- |
| `const { id } = profile; if (id === 'robota')`    | passed | FLAGGED `equality`            |
| `const { id: which } = profile; which !== 'acme'` | passed | FLAGGED `equality`            |
| `const a = profile.id; a.startsWith('acme')`      | passed | FLAGGED `string-predicate`    |
| `const { agentName } = p; switch (agentName)`     | passed | FLAGGED `switch`              |
| `table[profile['id']]`                            | passed | FLAGGED `identity-index`      |
| `globalThis['process'].env['HOME']`               | passed | FLAGGED `globalThis.process`  |
| `const proc = process; proc.env['HOME']`          | passed | FLAGGED `process.env`         |
| `await import('node:fs')` / `require(…)`          | passed | FLAGGED `forbidden-io-import` |
| member access split across lines                  | passed | FLAGGED `process.env`         |
| identity equality split across lines              | passed | FLAGGED `equality`            |

The four already-caught forms (literal equality, `switch (X.id)`, string predicate, identity index)
keep failing — the 14 pre-existing assertions were left untouched and stayed green through the
rewrite. New negative fixtures pin the AST's added precision (`host.readSettings()`, `process.cwd()`,
`const readSettings = 1`, `{ readSettings: 'x' }` are NOT IO edges).

**Reporter.** Guard (a) has always recorded WHICH dependency it found; the reporter dropped it and
printed only the package dir. `formatFinding()` is now an exported pure function that always prints the
offending dependency/identifier, and it is unit-tested:

```
  [forbidden-dependency]  packages/probe  @robota-sdk/agent-cli  — declared in [dependencies]
  [forbidden-io-identifier]  …/probe.ts:8  globalThis.process  — const h1 = globalThis['process'].env['HOME'];
  [product-name-conditional]  …/probe.ts:3  equality  — branches on `id`  ·  if (id === 'robota') doThing();
```

**Target set.** `packages/agent-capability-pack` was added to `compositionNeutrality` — the other half
of the ARCH-005 composition contract (the additive pack type + the pure `mergeCapabilityPacks` fold)
and an equally pure published contract package. It **passes clean** with no source change: no
forbidden dep, no fs/env/settings read, no product-identity branch. A test asserts both dirs are
configured, so the target set cannot silently shrink.

**No-op protection.** The `scan-target-missing` behavior is unchanged and now has an explicit test: a
configured package that does not exist yields two hard findings (`src/`, `package.json`), never a
silent pass.

**Verification.** `pnpm harness:verify-like-ci` → PASS, all 4 CI-mirroring stages (harness-self-test,
format-check, scan-suite on a built tree, typecheck). `pnpm harness:test` → 74 files / 797 tests
passed. The guard's own suite → 29/29 (13 of them red before the fix).

The `.agents/project-structure.md` L129 carve-out text is unchanged by design — this strengthens its
mechanism, it does not edit the rule.
