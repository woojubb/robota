# INFRA-017 Tasks — session-log replay provider + typed log schema

Spec: `.agents/spec-docs/active/INFRA-017-session-log-replay-provider.md`

## Tasks (TDD where practical)

- [ ] T1 (TC-01): export a typed log-event schema from `agent-session` (covers the events the logger
      emits); refactor `log()` call sites to the typed names; assert emitted JSONL is byte-unchanged.
- [ ] T2 (TC-02): scaffold `@robota-sdk/agent-provider-replay` (package.json, tsconfig, tsdown,
      docs/SPEC.md, src/index.ts) depending only on `agent-core` + `agent-session`.
- [ ] T3 (TC-03/04): implement the replay provider — parse a session-log JSONL, re-emit each turn
      (text deltas → tool calls → assistant completion); unit tests for text-only and tool-call turns.
- [ ] T4 (TC-05/06): typecheck (replay + session) + `pnpm build` (affected) + `pnpm harness:scan`
      green (SPEC, dependency-direction, naming, build-contracts).

## Test Plan

vitest unit tests (schema byte-stability; replay text-delta ordering; tool-call replay) +
`pnpm harness:scan` (dependency-direction proving the new package deps = agent-core + agent-session
only) + typecheck/build. Each TC must show evidence in the spec Evidence Log before GATE-VERIFY.
