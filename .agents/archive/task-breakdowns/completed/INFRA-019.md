# INFRA-019 Tasks — Programmatic in-process agent driver

Spec: `.agents/spec-docs/active/INFRA-019-programmatic-in-process-driver.md`

## Tasks

- [ ] T1 (TC-01): `ProgrammaticInteractionChannel implements IInteractionChannel` in
      `packages/agent-transport/src/programmatic/` — `onSubmit`/`submit`, `write` → event buffer,
      `requestAction` → FIFO response queue (empty → `cancelled`), `setAvailableCommands`/`setBusy`/
      `start`/`stop` state.
- [ ] T2 (TC-02/03/04): `createProgrammaticAgent` wrapping `createInteractiveRuntime` — `start`,
      `send` (awaits the turn), `stop`, structured accessors (`events`, `assistantReplies`,
      `lastAssistantText`, `toolCalls`, `errors`), `queueAction`. Export both + a `./programmatic`
      subpath; document in `docs/SPEC.md`.
- [ ] T3 (TC-02/03/04): in-process test `programmatic-driver.test.ts` using the scripted provider +
      temp cwd against the REAL `InteractiveSession` — assistant reply captured, event order, tool-call
      turn, queued/empty `requestAction`.
- [ ] T4 (TC-05): `pnpm --filter @robota-sdk/agent-transport typecheck` + `build` + suite green;
      `pnpm harness:scan` 33/33.

## Test Plan

In-process vitest functional tests in agent-transport against the real framework loop
(`createInteractiveRuntime` + real `InteractiveSession`) driven by the deterministic scripted provider
(`@robota-sdk/agent-core/testing`); harness:scan as the structural guard. Each TC shows evidence in the
spec Evidence Log before GATE-VERIFY.
