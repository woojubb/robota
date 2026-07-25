---
title: 'WORKFLOW-004: workflows build subcommand (LLM-assisted DAG authoring from the agent CLI)'
status: done
created: 2026-07-02
priority: medium
urgency: backlog
area: packages/agent-command-workflows, packages/agent-framework
depends_on: []
---

# `workflows build` subcommand

Deferred from WORKFLOW-003 (its TC-01 scope note): the `workflows` command module shipped
`list` / `catalog` / `validate` / `run`, but **`build`** — generating or scaffolding a `.dag.json`
workflow with model assistance — was deferred because it needs an **LLM-integration design decision**:
how an `ICommandModule` reaches the session's model provider.

## What

1. **Design decision first:** the seam by which a command module invokes the session's provider
   (e.g. a host-context capability like the existing `getAgentJobCapability()` pattern vs a
   command-prompt effect) — decide, spec, and confirm before implementation.
2. `workflows build <name|description>`: produce a valid workflow file (node graph over the
   `dag-framework` catalog), validate it with the existing `validate` path, and write it to
   `.dag/workflows/`.
3. Tests: module dispatch + a scripted-provider functional test that builds a small workflow and
   validates it; no `@robota-sdk/dag-cli` import (WORKFLOW-003 TC-02 boundary holds).

## Notes

- Additive to `packages/agent-command-workflows` — no re-architecting of the shipped subcommands.
- Follow the spec-first pipeline (GATE-WRITE onward) since this adds a model-facing product surface.
- 2026-07-25: **spec drafted** — `.agents/spec-docs/draft/WORKFLOW-004-workflows-build-subcommand.md`
  (GATE-WRITE draft). Decision proposed there: `build` = author→validate→save, never execute, reusing
  the FLOW-007 authoring pipeline + its provider seam (injected `providerDefinitions`, lazy
  `createProviderFromSettings`, `resolveProvider` test seam); a CMD-004 `ICommandHostAdapters` `model`
  adapter was weighed and deferred as the joint `create`+`build` migration path.

## Test Plan

- Module dispatch test for `build`; functional test with a scripted provider producing a small DAG;
  `validate` accepts the produced file; boundary `rg` stays 0; typecheck/lint/harness green.

## User Execution Test Scenarios

- Prereq: built CLI in a project with `.dag/workflows/`.
- Steps: run `robota`, invoke `/workflows build` with a short description, then `/workflows validate`
  and `/workflows run` on the produced file.
- Expected: a valid workflow file is created, validates cleanly, and runs (or reports a clear,
  actionable error); the file appears in `/workflows list`.
- Evidence: DONE 2026-07-25 — spec `.agents/spec-docs/done/WORKFLOW-004-workflows-build-subcommand.md`
  (GATE-VERIFY + GATE-COMPLETE evidence logs); agent-run UE
  `.agents/evals/scenarios/workflow-004-build-agent-run.md` (stub + live Anthropic runs, both PASS).
  Note: the seam decision landed on the FLOW-007 authoring seam (lazy `createProviderFromSettings`
  - injected `providerDefinitions`), shared with `create`; artifacts write to `.workflows/` (the
    FLOW-007 workspace), not the `.dag/workflows/` path this pre-FLOW-007 item guessed.
