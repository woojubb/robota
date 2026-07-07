# INFRA-033 — Decouple HTTP /submit completion + transport cleanup (ARL-04/07/06)

Spec: `.agents/spec-docs/active/INFRA-033-http-completion-decoupling.md`

## Tasks

- [ ] T1 (TC-01/02): In `packages/agent-transport-http/src/routes.ts` make the `complete`/`interrupted`/`error` handlers `async` and `await stream.writeSSE(...)` BEFORE `resolve()`. `error` RESOLVES (streams SSE error), does not reject. Remove the `if (!isThinking && completed) resolve()` coupling from `thinking`. Keep `cleanup` after `await done`.
- [ ] T2 (TC-02): Add a test — terminal event (complete/interrupted/error) NOT trailed by `thinking(false)`; assert the client RECEIVES the terminal SSE event and the response completes (exercises flush ordering).
- [ ] T3 (TC-03): Reword `routes.ts:5` "1:1" comment → subset ("exposes the core session methods; background/job-group/workspace are WS-only").
- [ ] T4 (TC-04): ARL-06 accept — no code change; do NOT add a `TServerMessage`/`TClientMessage` re-export to `agent-web-ui/src/index.ts`.
- [ ] T5 (TC-05): `pnpm build` + `pnpm typecheck` + full-repo typecheck + affected tests + `pnpm harness:scan` 45/45.
- [ ] T6 (TC-06): Mark ARL-04, ARL-06, ARL-07 Resolved in `.agents/architecture-remediation-log.md`. No agent-transport-http SPEC edit (no 1:1 claim there).

## Test Plan / 검증

The `/submit` completion promise now resolves on the terminal event (complete/interrupted/error), awaiting the SSE flush first (writeSSE is fire-and-forget → await before resolve→cleanup→close), removing the fragile dependence on a trailing thinking(false). Guard: a test that omits the trailing thinking(false) and asserts the client receives the terminal event. Green gate = build + full-repo typecheck + affected tests + harness:scan 45/45. Delegated to architecture-implementer; land via gated flow + merge-verifier (quality green before merge).
