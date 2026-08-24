---
title: 'ARCH-024: agent-framework hard-codes command ids owned by command modules (skills, compact, agent) in its routing/assembly while its SPEC claims "the SDK does not know command names contributed by modules in advance"'
status: done
created: 2026-08-13
completed: 2026-08-16
priority: medium
urgency: later
area: packages/agent-framework, packages/agent-command
depends_on: []
---

# ARCH-024: framework depends on module command names it claims not to know

## Problem

The framework SPEC states "The SDK does not know command names contributed by modules in advance", and
the command-module-isolation rule says the framework must not special-case command packages. But the
framework routing/assembly hard-codes four module-contributed command ids, so it does behaviorally
depend on them — the literal SPEC claim is false, and the isolation rule is honored only in the
presence-conditional sense (no imports, but hard-coded names).

## Evidence

- `packages/agent-framework/docs/SPEC.md:1161` — "The SDK does not know command names contributed by
  modules in advance."; `project-structure.md:127` — "`agent-framework` must not import or
  special-case command packages."
- Hard-coded ids: `interactive-session-skill-router.ts:161` `getCommand('skills')` (virtual-skill
  fallback route); `assembly/create-session.ts:113-118` gates model-visible skill metadata on a
  `'skills'` descriptor; `assembly/context-capacity-hint.ts:15` `COMPACT_COMMAND_NAME = 'compact'`;
  `assembly/create-subagent-session.ts:40` denylists `'agent'` by name. (No command-package IMPORTS
  exist — that half of the rule holds.)

## Direction

Add framework-owned optional semantic metadata to `ISystemCommand` with the closed roles
`skillActivation`, `contextReduction`, and `subagentSpawn`. The command-owner packages declare a role on
the executable command beside its real ID; the framework and CLI must not rebuild a second name registry.
The framework derives role→command ID from the currently composed command set. Duplicate owners of one
role fail with a typed composition error, including after `SystemCommandExecutor.replaceCommands()`.

Composition resolves one typed role projection from the actual `ISystemCommand` set and threads it
without name re-inference through `IInitOptions` → `ICreateSessionOptions` → agent-runtime/subagent-session
construction. Public direct `createSession()` calls that omit the projection have explicit all-roles-
absent semantics. The projection, not `commandDescriptors`, is the semantic source; command descriptors
remain presentation metadata.

Explicit absence semantics apply independently: no skill-activation role disables skill fallback and
model-visible skill enrichment; no context-reduction role leaves the neutral capacity hint in place; no
subagent-spawn role skips only projected spawn-command filtering. A coincidentally named
`skills`/`compact`/`agent` command without role metadata receives no special behavior, while a role-bearing
alternate ID behaves identically. The framework-owned legacy `Agent` tool filter remains separate.
`interactive-session-agent-jobs.ts` must also receive/derive the semantic spawn ID rather than embedding
`'agent'` in its command request. Record the public metadata addition for both framework and command
packages with a beta-line changeset.

## Recommendation Gate

- 2026-08-16 — `DEPTH: LOCAL`; the defect is framework name knowledge where composition owns the actual
  executable command set.
- 2026-08-16 — independent final review endorsed owner-declared closed semantic roles, typed projection
  threading, duplicate-owner rejection, alternate-ID behavior, and explicit per-role absence semantics.

REVIEW VERDICT: ENDORSE

## Test Plan

- Red-first: alternate role-bearing IDs drive skill fallback, model-visible skill enrichment, the compact
  hint, agent-job provenance, and subagent projected-tool filtering; same-name commands without metadata
  do not. Missing roles disable only their own behavior, and empty command results are not absence.
- Duplicate-role construction/register/replace fails with a typed error; role lookup follows the selected
  command set after `replaceCommands()`.
- A zero-hard-coded-ID scan covers all five production occurrences, including
  `interactive-session-agent-jobs.ts`.
- `pnpm harness:verify -- --scope packages/agent-framework` green.

## User Execution Test Scenarios

### Scenario: semantic command roles are independent of command ids

- **Agent executability:** `agent-executable`. A maintained public-SDK example uses the deterministic
  scripted provider and in-process framework surfaces only; it needs no live key, network service,
  browser, or TTY.
- **Prerequisites:** Node.js 22.14.0 and workspace dependencies installed. This work authors the
  command-owner example `packages/agent-command/examples/verify-semantic-command-roles.ts`, adds script
  `scenario:verify:semantic-command-roles`, adds the package-level aggregate `scenario:verify`, and adds
  `scenario:record` through the canonical owner recorder. It imports the shipped skills/compact/agent
  modules from their public owner package and uses framework public/testing surfaces for the session. The
  example creates its own temporary project/session directories.
- **Command:**

  ```bash
  volta run --node 22.14.0 pnpm --dir packages/agent-command run scenario:verify:semantic-command-roles
  ```

- **Expected observable:** exit code `0` and exactly one deterministic JSON object on stdout. It reports
  alternate role ids `activate-skill-alt`, `reduce-context-alt`, and `spawn-subagent-alt`; those exact ids
  drive skill fallback, the context-capacity hint, agent-job command provenance, and subagent
  spawn-command filtering. Its `unannotatedCoincidentalNames` object reports no special behavior for
  unannotated commands named `skills`, `compact`, and `agent`. Its `singleRoleOmission` object removes
  each role separately while leaving the other two behaviors active, and `duplicateRoleRejections`
  records typed failures for constructor, register, and replace without mutating the previously selected
  commands.
  `ownerDeclarations` proves the shipped skills, compact, and agent commands declare the three roles.
  `cleanupRemoved` is `true`. Any mismatch or cleanup failure writes a diagnostic to stderr and exits
  non-zero rather than printing a success object.

  **Narrowed after completion, and where the rest went.** The assertions about the system message an
  assembled session composes for a role projection — `alternateBehaviors.modelVisibleSkillEnrichment`,
  the prompt half of each `singleRoleOmission` leg, and `directCreateSessionOmission` — moved to
  `packages/agent-framework/src/__tests__/semantic-role-projection-in-assembled-session.test.ts`
  (PR #2296). They are agent-framework behaviour with no command module involved, and proving them from
  agent-command required reaching that package's `createSession` assembly factory through its public
  barrel, which is issue #2270. The third leg of the former `directCreateSessionOmission`,
  `subagentSpawnAbsent`, was already covered independently by
  `packages/agent-framework/src/__tests__/create-subagent-session.test.ts`. The dated evidence block
  below records the observable as it stood on 2026-08-16 and is left unchanged as history.

- **Cleanup:** the example shuts down every session and recursively removes its temporary project/session
  directories in `finally`; it restores any process state it changed.
- **Evidence (2026-08-16):** the exact command ran against the completed implementation and exited `0`.
  Stdout was
  `{"alternateRoleIds":{"skillActivation":"activate-skill-alt","contextReduction":"reduce-context-alt","subagentSpawn":"spawn-subagent-alt"},"alternateBehaviors":{"skillFallback":true,"modelVisibleSkillEnrichment":true,"contextCapacityHint":true,"agentJobCommandProvenance":true,"subagentSpawnCommandFiltering":true,"emptyCommandResultIsPresent":true},"unannotatedCoincidentalNames":{"skills":true,"compact":true,"agent":true},"singleRoleOmission":{"skillActivation":{"omitted":true,"contextReductionActive":true,"subagentSpawnActive":true},"contextReduction":{"skillActivationActive":true,"omitted":true,"subagentSpawnActive":true},"subagentSpawn":{"skillActivationActive":true,"contextReductionActive":true,"omitted":true}},"directCreateSessionOmission":{"allRolesAbsent":true},"duplicateRoleRejections":{"constructor":true,"register":true,"replace":true,"preservedCommands":true},"ownerDeclarations":{"skills":"skillActivation","compact":"contextReduction","agent":"subagentSpawn"},"cleanupRemoved":true}`.
  The maintained executable is
  `packages/agent-command/examples/verify-semantic-command-roles.ts`; its output matched
  `packages/agent-command/examples/scenarios/semantic-command-roles.record.json`; regenerate it
  with `volta run --node 22.14.0 pnpm --dir packages/agent-command run scenario:record` after the
  aggregate scenario includes this example.

## Scenario Plan Gate

- 2026-08-16 — revised after guardian review: the command-owner package scenario now covers its three
  shipped role declarations, alternate ids, coincidental unannotated names, duplicate-role typed failures
  across constructor/register/replace, three independent omissions, direct-call all-absent semantics,
  failure exit, cleanup, and the owner package's canonical record. Invocation probing reached the declared
  package and failed closed with `ERR_PNPM_NO_SCRIPT`; authoring that script/example is therefore an
  explicit prerequisite inside this work unit, not an assumed fixture.

SCENARIO DRAFTED: automatable | 1

- 2026-08-16 — independent PLAN guardian returned PASS for `semantic command roles are independent of
command ids`: the owner-package public-SDK scenario has complete prerequisites, exact invocation,
  observable and failure behavior, cleanup, canonical record ownership, and coverage of every endorsed
  runtime recommendation.

DONE-GATE-STAGE-1: PASS

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-16

**Status upgrade:** scenario-written → scenario-verified

- **Direct execution:** the exact public-SDK scenario ran twice against the completed implementation;
  both runs exited `0` and emitted byte-identical normalized JSON.
- **Expected observable:** alternate role ids drove all five behaviors; unannotated coincidental names
  remained inactive; independent omissions, typed atomic duplicate rejection, owner declarations, and
  `cleanupRemoved: true` all matched the planned output.
- **Canonical comparison:** owner aggregate verification reported validation findings `[]` and execution
  differences `[]`; scenario and canonical stdout SHA-256 were
  `70935e4fba9cd2c433ae2c6880a57d608a2b770cee8e5f27e1b924c554b1e1e0`.
- **Durable evidence:** `packages/agent-command/examples/verify-semantic-command-roles.ts` and
  `packages/agent-command/examples/scenarios/semantic-command-roles.record.json` exist.
- **Guardian verdict:** `GATE VERDICT: PASS`.
