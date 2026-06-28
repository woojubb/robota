# INFRA-020 Tasks — Test architecture foundation

Spec: `.agents/spec-docs/active/INFRA-020-test-architecture-foundation.md`

## Phase 1 — contract + programmatic conformance + framework charter (PR 1)

- [ ] T1 (TC-01): add `IAgentDriver` (client-side interaction contract) + pure accessors
      (`assistantReplies`/`lastAssistantText`/`toolCalls`/`errors` over `InteractionEvent[]`) to
      `agent-interface-transport`; export from index. Accessor unit test over a synthetic event array.
- [ ] T2 (TC-02): `createProgrammaticAgent` returns `IAgentDriver`; remove `IProgrammaticAgent`;
      accessors delegate to the shared helpers (no per-adapter filter logic). agent-transport suite green.
- [ ] T3 (TC-03): `agent-testing/docs/SPEC.md` — write the general-framework charter + placement rule;
      keep the PTY runner; update `.agents/project-structure.md` description.
- [ ] T4 (TC-06): repo-wide typecheck + `pnpm harness:scan` 33/33; no cycle.

## Phase 2 — agent-cli built-binary driver + cross-fidelity (PR 2)

- [ ] T5 (TC-04): built-binary `IAgentDriver` in agent-cli (agent-testing PTY runner + `--output-format
  stream-json` parse → `InteractionEvent`s); one shared scenario passes identically on the
      programmatic AND binary drivers.
- [ ] T6 (TC-05): relocate whole-binary CLI E2E into agent-cli; agent-transport-tui rendering PTY tests
      stay green consuming agent-testing.
- [ ] T7 (TC-06): typecheck + `pnpm harness:scan` 33/33.

## Follow-up (separate item)

- [ ] TEST-009 rewrite: agent-cli feature coverage targeting `IAgentDriver` (in-process via
      `startCli`/programmatic, real-binary via the binary driver).

## Test Plan

Per spec Test Plan (TC-01–06): accessor unit test, programmatic conformance suite, SPEC charter +
harness:scan, cross-fidelity scenario (programmatic vs binary), TUI rendering no-regression, repo
typecheck + scan. Evidence recorded in the spec Evidence Log before GATE-VERIFY.
