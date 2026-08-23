---
title: 'HARNESS-116: braceless relative imports are invisible to the owner-map scan'
status: done
created: 2026-08-23
completed: 2026-08-23
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-116: braceless relative imports are invisible to the owner-map scan

Registered as GitHub issue https://github.com/woojubb/robota/issues/2179.
Follows ARCH-100 (issue #2080), which introduced the scan.

## Problem

`scripts/harness/scan-interface-family-owner.mjs` proves that the contract-family owner map yields an
acyclic package graph. It builds that graph by parsing relative-import edges out of
`packages/agent-interface-transport/src` with a regular expression.

The expression requires **braces**. Two real dependency forms carry no braces and are therefore not
edges as far as the scan is concerned:

```ts
export * from './x'; // re-exports everything the target declares
import * as ns from './x'; // binds the target under a namespace
```

The gate cannot distinguish "no edge here" from "an edge I could not parse", so it reports a clean
acyclic graph either way.

## Existing Evidence

- The scan was already caught by this class once. Its first version matched only
  `import … from './x.js'`; a MUST review finding on PR #2176 showed it was blind to extension-less
  imports and to every `export … from` re-export. By its own unit of measure it saw 24 of 36
  relative-import statements — **67%**, blind to 33%.
- The corrected expression fixed both of those and kept the brace requirement, which is the residual.
- The only braceless form in the package today is
  `packages/agent-interface-transport/src/index.ts:298` — `export * from './session-mobility-contracts.js';`
  — and `index.ts` is excluded from the graph by design, so **no edge is dropped right now**.
- There are no namespace imports in the package at all.

## Directions Considered

- Extend the pattern to both braceless forms, resolving the edge to the target module's owner
  (chosen — no symbol is named, so the symbol-level owner map cannot apply).
- Parse with the TypeScript compiler API instead of a regular expression.
- Document the limitation in the scan header and leave the gap.

## Completion Criteria

- [x] `export * from './x'` and `import * as ns from './x'` produce graph edges to the target
      module's owner.
- [x] A regression test exists for each in which the braceless edge is the ONLY link between two
      owners, so the verdict flips rather than the fixture merely containing the form.
- [x] Each new test is demonstrated to fail against the pre-fix parser.
- [x] `pnpm harness:scan` exit 0.

## Test Plan

- Unit tests over the exported `projectGraph` / `findCycles`, using in-memory sources.
- Full harness scan and `pnpm harness:verify-like-ci`.

## User Execution Test Scenarios

This task delivers no user-facing behavior: it corrects a repository verification scan. The
verification surface is the harness gate, recorded in the Test Plan above.

## Outcome

Delivered by pull request #2183, squash-merged as `5ca65a477` on `develop` and verified present by content.
