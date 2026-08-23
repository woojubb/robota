---
title: 'ARCH-042: public SDK project authority is ambient'
status: done
created: 2026-08-22
completed: 2026-08-22
priority: critical
urgency: now
area: packages/agent-framework, packages/agent-session, packages/agent-provider-replay
depends_on: []
---

# ARCH-042: public SDK project authority is ambient

Registered as GitHub issue https://github.com/woojubb/robota/issues/2137.

## Problem

Public SDK project APIs still encode authority as a path, raw Node filesystem access, or an optional
reader. Session persistence, memory, checkpoints, task context, prompt references, and provider
settings repeat that shape. Securing one loader therefore leaves both existing bypasses and a contract
that will recreate the same bypass in the next project-scoped API.

This blocks `SECURITY-001`: its Restricted Mode claim cannot be true for direct SDK consumers while
public project loaders silently fall back to ambient filesystem access.

## Existing Evidence

- `packages/agent-framework/src/interactive/session-persistence.ts` defaults a project session store
  to raw Node I/O.
- Project memory, checkpoint, task-context, prompt-reference, and provider-settings surfaces each
  expose a capabilityless project path or raw-I/O fallback.
- The SECURITY-001 architecture refresh classified the repeated published contract as FOUNDATIONAL,
  not as a set of independent call-site bugs.

## Directions Considered

- Design one explicit public authority model separating host-owned content and generic filesystem
  adapters from project-scoped operations.
- Reject another optional-reader convention: absence has already acquired incompatible meanings.
- Reject per-loader patches because they retain ambient authority as the public extension pattern.

## Completion Criteria

- [x] TC-01 — Add the production-only, non-copyable project-authority mint/assert contract and adversarial
      type/runtime coverage.
- [x] TC-02 — Make capabilityless stateless and initial SDK construction observably Restricted without reading
      project canaries.
- [x] TC-03 — Preserve settings precedence through discriminated sources and require bounded project-settings
      mutation authority.
- [x] TC-04 — Migrate context, prompts, tasks, skills, commands, and agents to root-bounded readers plus separate
      host context/Git sources.
- [x] TC-05 — Move session record/log/payload behavior to explicit neutral ports, remove `getFilePath`, and
      preserve the declared logging degradation.
- [x] TC-06 — Adapt project memory and its pending queue to named authority state through the existing
      `IMemoryStore` contract.
- [x] TC-07 — Split checkpoint capture/state from permission-gated restore/delete mutation authority.
- [x] TC-08 — Keep session/replay adapters authority-neutral; make hydrated replay I/O-free and file replay use
      explicit sources.
- [x] TC-09 — Migrate every stateless and initial-construction CLI, command, workflow, TUI, transport, example,
      harness, diagnose, eval, and session-analysis consumer without a path-only compatibility shim.
- [x] TC-10 — Add and register the `public-project-authority` AST/public-surface guard with RED/GREEN fixtures.
- [x] TC-11 — Synchronize owner SPECs, architecture docs, READMEs/examples, run the affected verification suite,
      and preserve the explicit ARCH-043 lazy-session dependency.

## Test Plan

- TC-01: compile-fail public-contract tests plus runtime reflection/property/prototype forgery cases.
- TC-02–TC-04: framework permission-boundary, settings-source, context-root, and host-source integration tests.
- TC-05–TC-08: session record/log/payload, memory, checkpoint mutation, and replay source contract suites.
- TC-09: affected consumer builds/tests, CLI process scenarios, framework functional tests, and example typecheck.
- TC-10: RED/GREEN harness fixtures executed through `pnpm harness:scan`.
- TC-11: affected builds/typechecks/tests, framework functional verification, SPEC/SSOT checks,
  `pnpm harness:scan`, and `pnpm harness:verify-like-ci`.

## Recommendation Evidence

- `DEPTH: LOCAL` on 2026-08-22: the repeated path/raw-I/O/optional-reader public extension pattern is the root
  addressed by ARCH-042; ARCH-043 through ARCH-046 are separate consumers/dimensions rather than a deeper cause.
- `REVIEW VERDICT: ENDORSE` on 2026-08-22: independent architecture review endorsed framework authority
  ownership, transport session-contract SSOT, neutral lower ports, split capability facets, and the explicit
  ARCH-043 sequencing boundary.
- User approval: **“승인함”** on 2026-08-22 for the linked ARCH-042 design.

## User Execution Test Scenarios

`SCENARIO DRAFTED: automatable | 1` — `user-execution-scenario-author`, 2026-08-22.

- **Applicability:** required. ARCH-042 changes a published SDK construction contract and its observable
  Restricted-versus-authorized behavior for direct SDK consumers.
- **Surface chosen:** preference level 2, a maintained provider-free public SDK example owned by
  `agent-framework`. No existing self-contained product command observes both sides of this SDK-only boundary;
  the work therefore supplies the fixture it needs instead of requiring live credentials or a service.
- **Executability probe:** before this scenario was written,
  `pnpm --filter @robota-sdk/agent-framework exec tsx --conditions=source -e "import('./src/index.ts').then((sdk) => process.stdout.write(JSON.stringify({ surface: '@robota-sdk/agent-framework', loaded: typeof sdk.createAgentRuntime === 'function' }) + '\\n'))"`
  exited `0` and printed `{"surface":"@robota-sdk/agent-framework","loaded":true}`. This proves the
  non-interactive TypeScript invocation and public framework entry point resolve in the current workspace; the
  ARCH-042 authority surface itself is intentionally absent before implementation.

### S-1 — capabilityless construction stays Restricted while an explicit grant enables only its project

- **Executability:** agent-executable (`automatable`), fully offline and provider-free; no TTY, model provider,
  API key, or network access is required.
- **Prerequisite the work must build:**
  `packages/agent-framework/examples/verify-workspace-project-authority.ts` <!-- allow-missing-artifact: ARCH-042 will add this maintained public-SDK example during implementation. -->
  and a `scenario:verify:workspace-authority` script in `packages/agent-framework/package.json`. The example must
  create an isolated temporary Git project containing settings and context canaries, keep the host-owned trust
  identity/store outside that project, exercise the production trust service rather than a testing issuer, and
  run the same initial public SDK construction first without authority and then with the authority explicitly
  granted for that root.
- **Exact command:**

  ```bash
  pnpm --filter @robota-sdk/agent-framework scenario:verify:workspace-authority
  ```

- **Expected observable result:** exit `0` and one JSON line containing all of the following values:
  `"scenario":"ARCH-042"`; a `restricted` result with `"status":"restricted"`,
  `"reason":"WorkspaceAuthorityRequired"`, and `"observedCanaries":[]`; an `authorized` result with
  `"status":"trusted"` and
  `"observedCanaries":["ARCH_042_CONTEXT_CANARY","ARCH_042_SETTINGS_CANARY"]`; and
  `"cleanupRemoved":true`. Seeing either canary in the restricted result, failing to see both canaries after the
  explicit grant, accepting a grant for a different root, or any provider/network request must make the example
  exit non-zero.
- **Cleanup:** the example revokes/removes its isolated host trust grant and recursively removes its temporary
  project and host-state directories in `finally`; it asserts their absence before printing
  `"cleanupRemoved":true`. No repository or user-home state remains.
- **Evidence:** executed by the agent on 2026-08-22 with exit `0`. The command printed exactly one result
  object: `{"scenario":"ARCH-042","restricted":{"status":"restricted","reason":"WorkspaceAuthorityRequired","observedCanaries":[]},"authorized":{"status":"trusted","observedCanaries":["ARCH_042_CONTEXT_CANARY","ARCH_042_SETTINGS_CANARY"]},"cleanupRemoved":true}`.
  Restricted construction observed no project canary; the matching explicit grant observed both declared
  canaries; cleanup completed. The provider-free scenario is instrumented to fail on any provider request, and
  none occurred.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-22

**Status upgrade:** scenario drafted → scenario written (Task frontmatter `status: todo` is unchanged; this gate
authorizes no Task-status transition)

- **Ordering:** exempt — `DONE-GATE-STAGE-1` is an entry gate with no predecessor. The Task is under
  `.agents/tasks/`, contains its scenario section, and no implementation file for ARCH-042 is present in the
  working-tree changes, so the written-scenario gate precedes implementation.
- **S-1 field completeness:** PASS — the scenario names the maintained public-SDK example and package script that
  implementation must supply, gives the exact Bash command
  `pnpm --filter @robota-sdk/agent-framework scenario:verify:workspace-authority`, requires an isolated Git
  project and external host-owned trust state, specifies exact exit-0/JSON observables for both Restricted and
  explicitly authorized construction, defines bounded `finally` cleanup, and has a separate pending Evidence
  field for Stage 2.
- **S-1 executability:** PASS — it is explicitly `agent-executable` and fully offline/provider-free. The
  independent source-runner probe exited `0` and printed
  `{"surface":"@robota-sdk/agent-framework","loaded":true}`. The future example and package script are
  explicitly implementation prerequisites rather than silently missing runtime dependencies.
- **S-1 product surface:** PASS — the scenario drives initial construction through the published
  `@robota-sdk/agent-framework` SDK surface and observes its Restricted-versus-authorized result and project
  canary access. Its observable is not a build, typecheck, lint, unit test, harness/CI result, or repository-text
  inspection.
- **Credentials and external services:** PASS — the scenario explicitly states that no TTY, provider, API key,
  network access, or external service is required. The live-credential/external-service prerequisite clause is
  therefore N/A with a recorded reason, not skipped.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-22

**Status upgrade:** scenario written → scenario verified (Task frontmatter `status: in-progress` is unchanged;
this gate authorizes no Task-status transition)

- **Ordering:** PASS — `[DONE-GATE-STAGE-1]` above records `✅ PASS | 2026-08-22`. The implementation supplies
  the durable repository artifact `packages/agent-framework/examples/verify-workspace-project-authority.ts` and
  its `scenario:verify:workspace-authority` package script; both are present in implementation commit
  `885b79386`, and the current run used that completed artifact.
- **S-1 command executed:**
  `pnpm --filter @robota-sdk/agent-framework scenario:verify:workspace-authority` was independently re-run by
  this guardian on 2026-08-22 and exited `0`.
- **S-1 observed product result:** the public SDK scenario emitted
  `{"scenario":"ARCH-042","restricted":{"status":"restricted","reason":"WorkspaceAuthorityRequired","observedCanaries":[]},"authorized":{"status":"trusted","observedCanaries":["ARCH_042_CONTEXT_CANARY","ARCH_042_SETTINGS_CANARY"]},"cleanupRemoved":true}`.
  This exactly matches the pre-implementation expected result: capabilityless construction observed neither
  canary, the explicit matching grant observed both canaries, and cleanup succeeded. An independent post-run
  probe found zero `/tmp/arch-042-authority-*` directories.
- **Evidence location:** S-1's `Evidence` field above records the command date, exit code, exact result object,
  Restricted and authorized observations, cleanup, and absence of provider requests.
- **Evidence quality:** PASS — the observable comes from the maintained published-SDK example and its
  Restricted-versus-authorized behavior, not from build, typecheck, lint, test, harness, CI, or repository-text
  inspection. The expected result is unchanged from the Stage 1/HEAD version; only the evidence field was
  populated after execution.
- **Capability-absence and exception checks:** no exception or environment-capability absence is claimed; the
  scenario is explicitly offline and provider-free, so the unprobed-absence failure condition does not apply.
