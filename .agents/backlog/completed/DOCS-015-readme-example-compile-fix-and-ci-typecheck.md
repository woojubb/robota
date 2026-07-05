---
title: 'DOCS-015: README quickstart does not compile (defaultModel.systemMessage) — fix + CI typecheck for doc examples'
status: done
completed: 2026-07-03
created: 2026-07-03
priority: high
urgency: now
area: README.md, packages/agent-core/README.md, scripts/harness
depends_on: []
---

# README examples must compile — fix + gate

Discoverability report (`.design/feedback-discoverability-2026-07-03.md` §3.3, source-verified):
the Core quickstart in the root `README.md` (:48) and `packages/agent-core/README.md` (:25, and its
options table :94) puts `systemMessage` INSIDE `defaultModel` — but `IAgentConfig.defaultModel`
(`interfaces/agent.ts:79-87`) has no such field; `systemMessage` is top-level (:96). Under strict TS
the first example a consumer meets is an excess-property compile error. The report's key insight:
agents (and burned humans) trust `.d.ts` > tests > source > README precisely because of this class
of drift — the front-door example confirming the distrust is the worst possible surface for it.

## What

1. Fix the three occurrences (move `systemMessage` to the top level).
2. **Mechanize (the real deliverable)**: typecheck README/content TypeScript code blocks in CI or
   `harness:scan` (twoslash / typescript-docs-verifier / a small extract-and-tsc script — decide at
   implementation). New drift between doc examples and types must fail loudly, like any other
   enumerated-snapshot drift (same lesson class as common-mistakes #73/#74).
3. Sweep: run the checker over ALL existing README/content code blocks and fix what it finds — not
   just the reported one.

## Test Plan

- The doc-example typecheck gate passes on the fixed tree; a deliberately broken snippet fails it.
- `pnpm harness:scan` (or CI job) green; count of swept/fixed blocks recorded.

## User Execution Test Scenarios

- Prereq: fresh consumer project with strict TS.
- Steps: paste the root README Core quickstart verbatim; compile.
- Expected: compiles and runs without edits.
- Evidence (agent-run 2026-07-03): the new `doc-examples` scan (registered in `pnpm harness:scan`,
  which CI's quality gate runs) extracts every ts block from the root README + all packages/x
  READMEs and typechecks them against workspace SOURCE types (strict, es2023, jsx). Initial run
  exposed **29 broken blocks beyond the reported one** (first pass showed only 1 — a syntax error was
  suppressing all semantic diagnostics): nonexistent option fields (`LoggingPlugin backend→strategy`,
  `UsagePlugin storage→strategy`, `createHeadlessTransport format→outputFormat+prompt`,
  `createHttpTransport port→basePath`, `LimitsPlugin maxTokensPerMinute→strategy/maxTokens`),
  wrong arities (`createZodFunctionTool` object→4 positional args, command-module factories
  hostAdapters→0 args / provider module 1 required options arg), wrong type names
  (`IInteractiveSessionOptions→TInteractiveSessionOptions`), wrong ctor param
  (`TuiTransport(adapter)→IRenderOptions`), fictional APIs (`createSubagentSession({parentSession})`,
  `WebhookPlugin({url,secret})→endpoints[]`), missing required fields (`createAgentRuntime cwd`,
  streaming `stream: true`), and the reported `defaultModel.systemMessage` (3 spots). All fixed to
  the real contracts; 5 intentional fragments carry explicit `doc-example-skip` markers (reported,
  never silent). Final: **49 blocks typechecked green, 5 skips**. Root-README paste-compile scenario
  is exactly what the gate executes on every scan. Scope note: content/ (517 blocks / 70 files) split
  to DOCS-019 — the mechanism is ready; onboarding that corpus is its own effort.
