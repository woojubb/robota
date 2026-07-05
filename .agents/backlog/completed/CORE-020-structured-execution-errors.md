---
title: 'CORE-020: 실행 에러 구조화(error 필드) + bin.ts IME 휴리스틱 크래시 삼킴 제거'
status: done
created: 2026-07-04
completed: 2026-07-04
priority: high
urgency: now
area: packages/agent-core, packages/agent-cli
depends_on: []
---

# 실행 에러 구조화(error 필드) + bin.ts IME 휴리스틱 크래시 삼킴 제거

Re-audit P1-5 (RUNTIME-08 단서 반영 + RUNTIME-34). 실행 실패가 response:"Error:..." 문자열로
반환되고 error 필드 부재(success:false는 설정됨) — response 텍스트 소비 경로는 에러를 정상
응답으로 수신. bin.ts IME 휴리스틱은 'slice' 포함 일반 에러를 TUI 가드 검사 전에 삼킨다.

## What

1. 실패 결과 error 필드 신설 + response 에러 텍스트 주입 제거 — run()이 throw.
2. bin.ts IME 허용목록을 TUI 가드 활성 시로 한정(또는 스택 프레임 기반).

## Test Plan

- 실패 주입 시 run() throw + runStream 에러 전파; bin.ts 분기 테스트.

## User Execution Test Scenarios

- agent-executable. 라이브 headless(-p)로 실패 도구 실행 → 비정상 종료코드 + 에러 표면화 실측.
- Evidence: **PASSED 2026-07-04** — two live measurements:
  1. Live full-stack probe `scratch/src/core-020-user-execution.ts` (gitignored scratch
     workspace; recipe `pnpm --filter robota-scratch run run src/core-020-user-execution.ts`,
     key from the gitignored agent-cli `.env`, model claude-haiku-4-5): real baseline turn
     succeeded, then the explicit fault-injection point (provider chat/chatStream wrapped to
     return a malformed normalized response — `content: null`, no toolCalls — the class that
     escapes the round-level provider catch into the service catch) made `run()` REJECT with
     `[EXECUTION] Provider response must have content or tool calls`. Output:
     `outcome=rejected ... / CORE-020-OK` — previously this resolved as
     `response: "Error: [EXECUTION] ..."` with a success-looking exit.
  2. Live headless CLI (real binary, `robota -p ...`): invalid API key →
     `Request failed: 401 {...authentication_error...}` surfaced on the terminal and
     **EXIT=1** (fail-fast exit-code contract, no masked success).
- Side discovery: an invalid `--model` name silently succeeds (model substituted somewhere
  in the CLI→provider path) while the API 404s the same name — filed as CLI-076 with repro,
  out of CORE-020 scope.

## Implementation Evidence (2026-07-04)

- SPEC first: `packages/agent-core/docs/SPEC.md` — new invariant row: every `success:false`
  `ICoreExecutionResult` carries `error: Error`, `response` never carries error text;
  `robotaRun` throws for any non-interrupted failed result.
  `packages/agent-cli/docs/SPEC.md` § Process Survival Boundary — IME allowlist scoped to
  TUI-guard-active mode only; headless always rethrows.
- `packages/agent-core/src/services/execution-service.ts` — catch path now returns
  `error: Error` with `response: ''` (was `response: "Error: ${msg}"` with no error field).
- `packages/agent-core/src/core/robota-execution.ts` — `robotaRun` throws on EVERY failed
  result; a failed result missing `error` throws a `[STRICT-POLICY]` contract violation.
- `packages/agent-core/src/services/execution-stream.ts` — stream parity validation: a
  stream delivering neither string content nor tool calls throws the same
  `[EXECUTION] Provider response must have content or tool calls` (empty-string content
  remains valid); previously it completed silently.
- `packages/agent-cli/src/process-guards.ts` — new `classifyUncaughtException(err,
tuiGuardsActive)`: headless → always `'rethrow'`; TUI-active → `'ime-hint'` on IME
  signatures else `'guard-owned'`. `bin.ts` rewired to the classifier (heuristic no longer
  runs before the guard check).
- Tests (TDD, red→green): `robota.test.ts` 'failed execution contract (CORE-020)' (3 —
  run() rejects on malformed response, provider-throw parity, runStream rejection);
  `process-guards.test.ts` classify describe (3). agent-core 830/830, agent-cli guards 7/7,
  full workspace build/typecheck/test/lint green.
