# WORKFLOW-004 — `workflows build` subcommand (author → validate → save, never execute)

Spec (contract): `.agents/spec-docs/done/WORKFLOW-004-workflows-build-subcommand.md`
Branch: `feat/workflow-004-build` (base `origin/develop` @ `a6eb4e064`, PR #1356 merge)

## Plan (per approved spec — Solution P1)

- [x] SPEC-first: update `packages/agent-command-workflows/docs/SPEC.md` (new subcommand +
      provider-seam decision) BEFORE implementation code
- [x] TC-01 red-first: write `src/__tests__/build-command.test.ts` (stub provider via
      `resolveProvider`, execution spy/canary at 0 calls) — observe FAIL before
      `build-command.ts` exists
- [x] `src/build-command.ts` — `executeWorkflowsBuild(argStr, cwd, deps)` reusing
      `IWorkflowsCreateDeps` shape + shared `parseCreateArgs`; author → parse → assemble →
      bake input → save nodes + workflow; NEVER imports `authoring/execute-workflow.ts`
- [x] `workflows-command-module.ts` — `build` in SUBCOMMANDS (modelInvocable: true) + USAGE +
      dispatch; module test rows
- [x] TC-02 round-trip (validate + run the TC-01 artifact via existing executors)
- [x] TC-03 invalid spec → failed result, no fs write
- [x] TC-04 no provider → actionable error, no write
- [x] TC-05 newNodes → manifest under `<workspace>/nodes/`, still nothing executes
- [x] TC-06 boundary rg (single-prefix pattern) + PROVEN-CAN-FAIL: plant violating
      `@robota-sdk/agent-provider-defaults` import, observe rg hit, remove (paste sequence)
- [x] Changeset (minor — new subcommand)
- [x] VERIFY: package build + full vitest + `pnpm -w typecheck` + `node scripts/harness/run-all-scans.mjs`
- [x] User Execution scenario `.agents/evals/scenarios/workflow-004-build-agent-run.md` —
      agent-run, stub provider + live provider (ANTHROPIC_API_KEY confirmed available)
- [x] Evidence Log filled per gate; spec → done ONLY with agent-run evidence for every criterion;
      backlog item archived

## Test Plan

Per the approved spec (its `## Test Plan` table is the contract): TC-01 red-first integration test
with a stubbed provider asserting save + message + a 0-call execution canary on
`LocalDagRuntimeProvider.prototype.execute`; TC-02 round-trip through the existing
`validate`/`run` executors; TC-03 invalid/unassemblable spec → failed result + untouched fs;
TC-04 no-provider actionable error (both the settings path with keys stubbed empty and a throwing
injected resolver); TC-05 `newNodes` manifest persisted inert with no execution; TC-06 rg boundary
asserts (dag-cli + agent-provider- prefixes) with a proven-can-fail plant/hit/remove sequence, plus
package typecheck/test/build, full workspace vitest, `pnpm -w typecheck`, and
`node scripts/harness/run-all-scans.mjs` all exit 0. User Execution: agent-run scenario file
`.agents/evals/scenarios/workflow-004-build-agent-run.md` executed with the stub provider and the
live provider (ANTHROPIC_API_KEY present).

## Log

- 2026-07-25: started. #1356 merged (a6eb4e064); worktree reset onto origin/develop; spec
  todo→active, status in-progress.
- 2026-07-25: COMPLETE. TC-01 red observed → 8/8 green; TC-06 plant/hit/remove executed; all 60
  scans pass; full workspace test + `-w typecheck` exit 0; UE scenario run twice (stub PASS, live
  Anthropic PASS). Spec → done/, backlog → completed/. Spec references in this file now point at
  `.agents/spec-docs/done/`.
