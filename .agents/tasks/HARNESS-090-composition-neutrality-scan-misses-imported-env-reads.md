---
title: 'HARNESS-090: the composition-neutrality scan is weaker than the guarantee it is coupled to — a named import of node:process reads env and passes guard (b)'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: scripts/harness/scan-composition-neutrality.mjs, .agents/harness.config.json, packages/agent-product
depends_on: []
---

# HARNESS-090: neutrality scan misses imported env reads

## Problem

The ARCH-005 carve-out that lets `agent-product`'s `assembleProduct` exist as a shared, published
assembler is explicitly conditioned on the composition-neutrality guards: "(b) no fs/env/settings
read" (`.agents/project-structure.md:133`). The package SPEC claims the qualified form "cannot evade
the check" (`packages/agent-product/docs/SPEC.md:28-31`). The scan does not deliver that guarantee:
an environment read through an import binding passes.

## Evidence

- `.agents/harness.config.json` `compositionNeutrality.forbiddenImports` (~:115,:139) lists only
  fs/os modules — no `node:process`/`process`, no `child_process`/`net`/`http`.
- `scripts/harness/scan-composition-neutrality.mjs:198-214` — `collectAliases` tracks variable
  declarations and destructured parameters, never import bindings. Hence
  `import { env } from 'node:process'; env.HOME` (access path `['env']`) and
  `import * as p from 'node:process'; p.env` match neither `forbiddenImports` nor the `process.env`
  forbidden-identifier check. The default-import case is caught only because the local name happens
  to be `process`.
- The scan's own header claims the AST port "removes that whole evasion class at once"
  (`scan-composition-neutrality.mjs:24-33`).

## Direction

1. Add `node:process` and `process` (and decide on `node:child_process`, `node:net`, `node:http` —
   IO the purity claim equally forbids) to `forbiddenImports`.
2. Track import specifiers of banned modules as identity aliases in `collectAliases`, so named and
   namespace imports of a banned module are followed like local aliases.
3. Land the red-first probes (HARNESS-048 pattern): a fixture with `import { env } from
'node:process'` must FAIL the scan before the fix and pass detection after.

## Test Plan

- Red-first: probe fixtures for named-import, namespace-import, and default-import env reads — scan
  must flag all three (today it flags only the third).
- Existing neutrality suite still green on `agent-product`/`agent-capability-pack` sources.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — harness/guard change only; verification is the red-first probe suite in the Test
Plan.
