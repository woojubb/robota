---
title: 'README-001: Flesh out stub READMEs for published transport packages'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: low
urgency: later
area: packages/agent-transport-http, packages/agent-transport-mcp
depends_on: []
---

## Evidence Log (2026-06-27)

- `agent-transport-http/README.md` + `agent-transport-mcp/README.md` expanded from 9-line stubs
  to full READMEs: purpose, install, a runnable usage snippet using only real exports
  (`createAgentRoutes({ sessionFactory })`, `createAgentMcpServer({ name, version, session })`),
  and an exports table verified against `src/index.ts` + the option interfaces.
- Verified: docs structure validation passes; snippets use existing exports only.

# Flesh out stub READMEs for published transport packages

## What

Two published packages have stub READMEs (9 lines each — title + a pointer to `docs/SPEC.md`,
no usage):

- `packages/agent-transport-http/README.md`
- `packages/agent-transport-mcp/README.md`

npm renders the README on the package page, so a published package with a bare stub reads as
unfinished. Add a non-trivial README for each: one-line purpose, install line, a minimal usage
snippet (verified against the real exports), and a link to the SPEC — consistent with the
fuller READMEs other published packages already have.

## Why

The README is the package's npm landing page. A stub undersells a shipped package and is
inconsistent with the repo's other published READMEs; the three-doc-layer rule also expects
README ↔ SPEC parity.

## Done When

- Both READMEs have purpose + install + a working usage snippet + SPEC link (>~20 lines of
  real content).
- Snippets import only symbols that actually exist (typecheck the snippet).
- `pnpm docs:validate-readmes` (if it asserts content) passes.

## Test Plan

- Verify each README's snippet against the package's real exports.
- Visual check: README is non-stub and matches the style of a known-good package README.

## User Execution Test Scenarios

1. Open the package's npm/README page → there's a clear purpose, install, and a runnable usage
   example, not just a SPEC pointer. Evidence: _to fill._
