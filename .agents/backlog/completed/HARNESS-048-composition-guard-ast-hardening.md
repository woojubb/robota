---
title: 'HARNESS-048: composition-neutrality guard — close the destructure/alias/bracket evasions'
status: todo
created: 2026-07-25
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
