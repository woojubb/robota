---
title: 'ARCH-010: carry a trusted execution root through the remaining DAG execution contract'
status: done
created: 2026-08-02
completed: 2026-08-13
priority: critical
urgency: now
area: packages/agent-session, packages/agent-tools, packages/agent-framework, packages/agent-executor, packages/agent-subagent-runner, packages/dag-core, packages/dag-nodes
depends_on: []
---

# ARCH-010: carry a trusted execution root through the remaining DAG execution contract

## Current scope correction

The original report below is retained as the historical defect record, but it no longer describes the
whole current tree. P1 has landed: session/tool construction requires `cwd`, the agent tool guard fails
closed, and both child-process and in-process subagent paths propagate the selected root. The remaining
work is P2, the DAG execution path. `ITaskExecutionInput` and `INodeExecutionContext` still carry no
trusted root, so filesystem-capable DAG nodes still reconstruct authority from `process.cwd()` or from
LLM-authored node configuration.

The original suggestion to reuse `IWorkspaceLayout.root` is also stale. That field is a project-relative
workflow-definition storage location such as `.workflows`; it is not an absolute execution authority.
Definition layout and runtime containment remain separate contracts.

## Recommendation Gate — 2026-08-12

**Depth verdict: FOUNDATIONAL.** The defect is the missing root on the contracts that carry task and node
execution, not any one filesystem node. It already forces `tool`, `file-read`, `file-write`, and `skill`
to repeat ambient or attacker-controlled root selection and would force future nodes to do the same.

**Endorsed recommendation:**

1. `dag-core` owns required `executionRoot: string` fields on `ITaskExecutionInput` and
   `INodeExecutionContext`. `LifecycleTaskExecutorPort` is the explicit projection between those two
   contracts, and the same value reaches every lifecycle phase.
2. The root travels as an execution-composition dependency through the worker and into each task input;
   it is not worker retry/timeout policy. Lower layers never reconstruct or default it.
3. `createDagFramework({ executionRoot? })` is the sole generic convenience boundary allowed to preserve
   no-argument construction by immediately strict-validating and canonicalizing `process.cwd()`. Product
   producers that already know their project/invocation directory pass it explicitly.
4. `@robota-sdk/agent-core/node`, beside the existing `canonicalizePath`/`isPathInside` SSOT, owns strict
   trusted-root validation: non-string, empty, relative, nonexistent, non-directory, or inaccessible roots
   are refused; an accepted root is returned as its canonical absolute real path. Candidate write-path
   canonicalization remains tolerant of a not-yet-created tail.
5. `tool`, `file-read`, `file-write`, and `skill` use only `context.executionRoot` as containment authority.
   Node configuration may narrow within it but may never widen it through an absolute path, `..`, or an
   escaping symlink.
6. `dag-node-skill` is explicitly corrected to Node-only: its current browser condition points to the
   same filesystem-oriented Node build and is a false capability claim. The browser condition is removed,
   the shared Node containment SSOT is reused, and the manifest/SPEC/changeset record the public-surface
   correction.
7. The migration is spec-first and red-first, covers every production composition plus custom executor
   propagation, and ends with a provider-free public-product scenario, full verification, independent
   review, and atomic Task archival.

**Independent review:** `REVIEW VERDICT: ENDORSE` — 2026-08-12. The reviewer confirmed the single
directional authority flow, owner placement, compatibility boundary, Node-only skill classification,
test/scenario plan, and ordering before RUNTIME-003/RUNTIME-004.

### Done Gate audit record — 2026-08-12

- The scenario authoring guardian returned `DONE-GATE-STAGE-1: PASS` before implementation and before
  the scenario was executed, but that verdict was not immediately appended to this Task.
- The completed implementation's unchanged scenario later exited `0` with all expected containment,
  narrowing, non-disclosure, and cleanup observables recorded in the durable artifact.
- The independent Stage 2 guardian therefore returned `GATE VERDICT: NON-COMPLIANCE`: the prerequisite
  Stage 1 PASS existed only in conversation, not in the designated repository evidence surface when
  Stage 2 began. Its Stage 2 behavior evidence was not evaluated.
- This record is deliberately not a retroactive Stage 1 PASS and ARCH-010 remains `in-progress`.

### One-time process disposition — approved 2026-08-13

- The user explicitly approved the recommended ARCH-010-only recovery on 2026-08-13 after receiving
  its scope, alternatives, evidence, and audit consequences. This approval does not establish a
  reusable exception for any later backlog.
- For this one item, the pre-implementation conversational `DONE-GATE-STAGE-1: PASS` is accepted as
  historical Stage 1 evidence. The omission was its failure to land promptly in this designated Task
  surface; the original Stage 2 `NON-COMPLIANCE` above remains part of the record and is not rewritten.
- Completion still requires an unchanged fresh scenario run against the completed implementation and
  a fresh independent Stage 2 verdict. Only a Stage 2 PASS permits `status: done` and atomic archival.
- The unchanged scenario was freshly executed on 2026-08-13 after this disposition was recorded. It
  exited `0` with execution root `/tmp/robota-arch010.eAZLog/project`; all expected containment and
  narrowing observables matched, the outside sentinel was not disclosed, and bounded cleanup passed.
  The fresh independent guardian then returned `GATE VERDICT: PASS`: direct execution, exit status,
  every expected product observable, durable evidence, sentinel non-disclosure, cleanup, and use of a
  public product surface all satisfied `DONE-GATE-STAGE-2`.

## Problem

A subagent or a DAG node can read files outside its intended root and get **content back rather than
an error**. The working root is not a member of any execution contract, so every construction site
either invents it from `process.cwd()` or silently disables the containment guard that depends on it.
The guard is fail-open: with no root supplied it returns "allowed".

This is the strongest multi-sighting in the whole audit — three independent auditors, at three
different heights, each traced a different symptom back to the _same_ missing field. It also blocks
the subagent-isolation and workspace work stacked above it.

## Evidence

Observed independently by **L1 (runtime)**, **L2 (assembly)** and **L5 (DAG)**.

- L1 #2 — `packages/agent-session/src/session.ts:108` → `this.cwd = process.cwd();`, and
  `packages/agent-session/src/session-types.ts:38-145` (`ISessionOptions`) has **no `cwd` field**.
  That ambient value flows into every hook input and `CLAUDE_PROJECT_DIR`
  (`session-lifecycle.ts:56-66,:86-97`; `session-run.ts:140-149,:246-253,:300-312`), into
  `PermissionEnforcer.cwd` (`session.ts:141-147` → `permission-enforcer.ts:58`), and into the
  persisted record (`session-history-ops.ts:131`). Meanwhile the spawn contract declares it
  **required** — `packages/agent-executor/src/subagents/types.ts:22-28` `ISubagentSpawnRequest.cwd:
string` — and `packages/agent-framework/src/subagents/in-process-subagent-runner.ts:134-160` passes
  no cwd, because the option does not exist.
- L2 F1 — `packages/agent-subagent-runner/src/child-process-subagent-worker.ts:95-100` calls
  `createDefaultTools()` **with no argument**, so `cwd` is `undefined`, and
  `packages/agent-tools/src/builtins/path-guard.ts:41-42` is then a no-op
  (`if (cwd === undefined) return undefined;`). `packages/pack-coding/src/coding-pack.ts:22-28`
  states the consequence in its own doc: _"file tools constructed with no options carry a DISARMED
  working-directory guard: their `Read` will happily return `/etc/hostname`."_ Nothing downstream
  re-binds it — `create-subagent-session.ts:157` only _filters_ the array.
- L1 18e — `packages/agent-tools/src/builtins/path-guard.ts:37-40`: `isWithinCwd` returns `true` when
  `cwd === undefined`. The guard is fail-open by default.
- L5 F12(b) — `packages/dag-nodes/tool/src/containment.ts:22-24` names the same missing field as its
  reason: _"`INodeExecutionContext` carries no workspace root, so this makes explicit the boundary the
  node was already implicitly claiming."_ Confirmed at
  `packages/dag-core/src/types/node-lifecycle.ts:13-23`; `IWorkspaceLayout` exists in `dag-core`
  (`types/workspace-layout.ts`) and is never threaded in. Same anchor at
  `dag-nodes/file-read/src/index.ts:28,94` and `file-write/src/index.ts:30,100`.
- L5 F12(c) — `packages/dag-nodes/skill/src/index.ts:96` → `cwd: config.cwd ?? process.cwd()` with no
  `resolveContainmentRoot` call, taking the root from the same LLM-authorable `.dag.json` that
  `containment.ts:25-27` argues must not be trusted (_"a root the attacker supplies is not a root"_).

The synthesis re-verified, read-only: `session-types.ts` has no `cwd`; `session.ts:108` and the
worker's bare `createDefaultTools()` are verbatim as reported.

The cause in one sentence, from the synthesis: _the working root is an ambient process fact rather
than a required field on `ISessionOptions` / `INodeExecutionContext` / the tool factory, so every
construction site either invents it or silently disables the guard that depends on it._

## Why this is foundational (or not)

**FOUNDATIONAL.** L1, L2 and L5's `cwd` half all agree. L5 marks only the _duplication_ half of its
own finding (F12) LOCAL. The defect is not any one call site: the field does not exist on the
contracts, so no caller above can supply it and no fix above the contract can be complete.

The synthesis rates it **BLOCKER**: three layers, a security property, and silent — an
out-of-root read returns content rather than an error.

## Direction

Make the execution root a **required** member of the contracts that carry execution:
`ISessionOptions`, `INodeExecutionContext` and the tool factory. The invariant the synthesis states
for this class (theme T3) is that _an admission or containment decision must be enforced by a
mechanism the contract requires, not by a convention each implementation may or may not follow_; and
for theme T5, that _state whose correct value depends on a call or a session must not live on a
module or ambient process fact_.

Two seams the synthesis names as already existing and unused:

- `IWorkspaceLayout` in `dag-core` (`types/workspace-layout.ts`) — exists, never threaded into
  `INodeExecutionContext`.
- `resolveContainmentRoot` in `dag-nodes/tool/src/containment.ts` — the correct shape, not called by
  the `skill` node.

The risk the synthesis names: the guard's current default is **fail-open**
(`path-guard.ts:37-40` returns `true` for `cwd === undefined`), so making the field required without
also inverting that default leaves every not-yet-migrated construction site silently unprotected.
The `skill` node additionally shows that taking the root from LLM-authorable config is not a fix —
_"a root the attacker supplies is not a root"_.

## Test Plan

- **Required red-first regression:** a test that constructs the child-process subagent worker path
  (`child-process-subagent-worker.ts` → `createDefaultTools()`) and asserts a `Read` of an absolute
  path outside the intended root is **rejected**. Against current code this test must FAIL — today it
  returns the file contents, per `coding-pack.ts:22-28`'s own doc comment.
- A second red-first test on `path-guard.isWithinCwd` asserting that an absent root is refused, not
  allowed (today `:37-40` returns `true`).
- A DAG-side red-first test: a `skill` node whose `.dag.json` supplies a root outside the workspace
  must be contained by the injected workspace root, not by the config value
  (`dag-nodes/skill/src/index.ts:96`).
- Type-level: removing `cwd` from a construction site must fail `pnpm typecheck` once the field is
  required on `ISessionOptions` / `INodeExecutionContext`.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies.** This changes runnable behavior on a shipped product surface: what a subagent is allowed
to read.

- **Durable provider-free DAG scenario:**
  [`.agents/evals/scenarios/arch-010-dag-execution-root-agent-run.md`](../../evals/scenarios/arch-010-dag-execution-root-agent-run.md)
- **Executability:** `agent-executable`; it drives public `createDagFramework` with local fixtures and
  no provider credentials or external service.
- **Current Done Gate evidence:** executed 2026-08-12; exit `0`. The public framework reported
  `absoluteOutsideRead: "denied-without-content"`, all three cwd-widening forms as `"denied"`,
  `internalNarrowing: "success"`, and `outsideSentinelDisclosed: false`. The cleanup trap removed the
  generated script and `/tmp/robota-arch010.a3bdPo`; the durable artifact contains the exact output.
- **Coverage:** a sibling outside-root sentinel read must be denied without content disclosure;
  authored `config.cwd` cannot widen by absolute path, `..`, or escaping symlink; an internal
  subdirectory remains a valid narrowing root.
- **Prerequisites / exact Bash / expected observable / cleanup:** owned in the linked durable artifact
  so the executable recipe has one canonical copy. Its temporary sibling sentinel replaces the prior
  `/etc/hostname` idea: it is host-independent and proves non-disclosure with unique content.

## Progress

### P1 — the root is a required field, and the guard fails closed (2 of 3 phases; ~67%)

**The guard.** `packages/agent-tools/src/builtins/path-guard.ts` — `isWithinCwd(path, undefined)`
returned `true`, so with no root everything was inside it. It now returns `false`, and
`checkPathWithinCwd` returns a refusal naming the real fault ("no containment root is configured …
this is an assembly bug, not a path problem") rather than an ordinary out-of-root message. Inverting
this FIRST is what the Direction's risk note asks for: making the field required without it would
leave any not-yet-migrated site silently unprotected.

Measured, not inferred: before the change, a `Read` built with no root returned
`[File: /etc/hostname (1 lines)]\n1\tserver`. That is `pack-coding`'s doc comment, reproduced.

**The contracts.** `cwd` is now REQUIRED on `ISandboxToolOptions`, `IContainedBuiltinToolOptions`
(and therefore `ISandboxBuiltinToolOptions`/`IShellToolOptions`/`IGrepToolOptions`),
`ICreateDefaultToolsOptions`, `ISessionOptions`, and `ISubagentOptions`. The `= {}` default parameter
is gone from every builtin factory — that default was the mechanism by which "forgot the root" was
legal. `Session` no longer reads `process.cwd()` in its constructor, and `getCwd()` exposes the root
so a fork or subagent asks the session rather than re-deriving one that can disagree.

**The call sites the type system then named**, each fixed with the root that was already in scope:
`child-process-subagent-worker.ts` (`payload.request.cwd` — the spawn contract had carried it all
along), `in-process-subagent-runner.ts` (`job.request.worktreePath ?? job.request.cwd`, so a
worktree-isolated subagent runs in its worktree), `create-session.ts` (the same `cwd` it had already
bound the tools, hooks and skill source to), `create-subagent-session.ts`, `interactive-session-fork.ts`
(`parentSession.getCwd()` — a fork continues the same conversation in the same place).

**Seven context-free singletons removed** — `readTool`, `writeTool`, `editTool`, `globTool`,
`grepTool`, `shellTool`, `bashTool`. A module-level instance is bound at import time and can carry no
root, so post-inversion they could only refuse; they had no in-repo consumer, and every assembly
already built per-session tools. Keeping them would have meant shipping seven exports that always
fail — the same declared-but-unreachable shape the audit is about. SPEC and README updated.

**A control test that depended on the defect.** `enumeration-containment.test.ts`'s CONTROL pair
proved the escape was real by running Glob/Grep with NO root — which worked only because the guard
was fail-open, so closing it turned the control red. Grep's control now uses a WIDER root; Glob's
uses a `..` traversal instead of the symlink, because a contained Glob sets
`followSymbolicLinks: false` and so cannot observe a symlink escape under any root. A control that
depends on a defect elsewhere stops being a control the moment that defect is fixed.

**Required is enforced at RUNTIME too, not only by the type.** `Session`'s constructor refuses a
missing, empty or non-string `cwd` with an error naming what the value FEEDS. This is not belt-and-
braces: this package's tsconfig EXCLUDES `*.test.ts` and a JavaScript consumer is not type-checked at
all, so the field would otherwise simply be `undefined` and the session would report a root it does
not have. The error says what consumes the root so a caller can judge whether `process.cwd()` is
actually right, rather than pasting it in reflexively — which is the ambient read this removes.

**Red-proof (8 cases, all on named assertions, no timeouts).** Restoring the two defects — the
fail-open guard and the constructor's `?? process.cwd()`:

```
× a session must be told where it runs > REFUSES to construct with no execution root
  → expected [Function] to throw an error
× … > refuses an empty string / a non-string / names what the value is FOR   (3 more, same shape)
× checkPathWithinCwd > REFUSES when cwd is not set          → expected undefined to be defined
× containment is fail-closed > isWithinCwd REFUSES …        → expected true to be false
× containment is fail-closed > checkPathWithinCwd returns a refusal …
× containment is fail-closed > a Read built with no root REFUSES an absolute path …
```

### Pre-implementation P2 finding (historical)

Before the P2 implementation, `INodeExecutionContext` carried no workspace root, and
`dag-nodes/skill/src/index.ts:96` took its root from the LLM-authorable `.dag.json`
(`config.cwd ?? process.cwd()`) without calling
`resolveContainmentRoot`.

A finding that changes the shape of that work, recorded here rather than acted on blind: the
synthesis names `IWorkspaceLayout` (`dag-core/src/types/workspace-layout.ts`) as the existing unused
seam, but its `root` is a path RELATIVE to the project dir (`.workflows`) and it describes where
workflow DEFINITIONS live — it is not an absolute execution root and cannot be threaded in as one
without changing what it means. `INodeExecutionContext` also has 57 consumers, so adding a required
member there is its own migration. P2 needs a design pass, not a mechanical edit.

### P2 completion — 2026-08-13

The endorsed DAG contract implementation is complete. `dag-core` now requires `executionRoot` on task input and
node lifecycle context; framework/worker/CLI/workflow compositions propagate it; the generic framework
factory alone preserves no-argument compatibility by validating and capturing its current directory.
`agent-core/node` owns strict trusted-root validation. Tool, file-read, file-write, and skill nodes use
the injected root, and the filesystem-backed skill package no longer advertises a browser condition.

Engineering evidence at this checkpoint: full workspace typecheck PASS; package tests PASS for
agent-core (949), dag-core (183), dag-worker (85), dag-framework (137), dag-cli (1,039), workflows (48),
plus affected filesystem-node suites; `pnpm harness:scan` PASS (108 scans, 1 skipped). Final independent
checkpoint review converged at `ACTIONABLE FINDINGS: 0`. A fresh `pnpm harness:verify-like-ci` passed all
11 mirrored stages, including build, affected verification, binary E2E, examples typecheck, and TUI PTY
E2E. Following the explicitly approved one-time disposition, the unchanged public scenario was rerun,
exited `0`, and the independent Stage 2 guardian returned `GATE VERDICT: PASS`.

## Result

ARCH-010 is complete. Trusted execution authority now travels from product/framework composition through
the worker task input into every DAG node lifecycle phase. Filesystem-capable nodes can narrow that root
but cannot derive or widen it from ambient process state or authored configuration. Strict validation,
canonical containment, symlink-escape regressions, package contract updates, and the durable public
scenario prove the behavior. No follow-up work remains within this Task's corrected P2 scope.
