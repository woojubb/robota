---
title: 'EXAMPLES-001: Bring examples/ under CI typecheck/build so SDK API drift fails fast'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: high
urgency: soon
area: examples, root (workspaces, ci)
depends_on: []
---

## Evidence Log (2026-06-27)

- Decision (user-approved): examples become **workspace members** (`pnpm-workspace.yaml` +
  package.json `workspaces` add `examples/*`) so pnpm links `@robota-sdk/*` to local source and
  NodeNext resolves the real exports (incl. sub-paths like `agent-provider/anthropic`).
- Excluded examples from harness scans: `listWorkspaceScopes` (shared.mjs) skips the `examples`
  root, so the 32 scans are unaffected (examples have no SPEC.md / are private).
- `examples:typecheck` root script + CI job (`examples-typecheck`, build:deps → typecheck).
- **Proved drift detection**: the gate immediately caught `examples/express` using the removed
  `createFunctionTool` + an outdated `IAgentConfig`. The 8 other examples pass against current
  source. express is quarantined (`!robota-example-express`) and tracked by **EXAMPLES-002**.
- Verified: `examples:typecheck` 8/8 green, `harness:scan` 32/32, `build:deps` OK,
  `install --frozen-lockfile` OK.

# Bring examples/ under CI typecheck/build

## What

`examples/` (9 projects) is excluded from the pnpm workspace (`package.json:186-189`
lists only `packages/*` and `apps/*`) and is **never referenced in `.github/workflows/ci.yml`**
(verified: 0 hits). No `examples:test` / `examples:typecheck` / `examples:build` root script
exists, and no example has a `test` script. Consequence: **example code is never type-checked
against the real SDK exports**, so an API change silently rots every example — which is exactly
how the stale `createOpenAIProvider` quickstart drift (DOCAUDIT-005) reached a shipped doc.

Add a CI-enforced validation for examples:

1. A root script (e.g. `examples:typecheck`) that type-checks each example against the
   workspace-built SDK (install + `tsc --noEmit` per example, or fold examples into the
   workspace if dependency resolution allows).
2. A CI job/step that runs it on PRs touching `examples/` or published packages, so an SDK
   export rename breaks CI instead of shipping a broken example.

(Scope decision — whether to add `examples/*` to `workspaces` vs. validate them as standalone
installs — should be made explicitly; folding into workspaces changes lockfile/release scope,
so present the trade-off rather than deciding unilaterally.)

## Why

Examples are the second thing (after quickstart) a new user copies. With no typecheck gate
they drift undetected on every API change. This is the systemic root cause behind one-off
stale-example backlogs; a gate fixes the class, not the instance.

## Done When

- A root script type-checks all `examples/*` against the current SDK and fails on a missing
  export.
- CI runs it (at least on PRs that touch `examples/` or published `packages/`).
- All current examples pass (or the genuinely-broken ones are filed/fixed as part of this).

## Test Plan

- Run the new script locally → all examples typecheck (or surface the real breakages).
- Rename/remove an SDK export in a scratch branch → the examples check fails in CI.

## User Execution Test Scenarios

1. Change a public SDK export name on a branch and open a PR → CI's examples check fails,
   naming the example and the missing symbol. Evidence: _to fill._
