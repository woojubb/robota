---
title: 'HARNESS-024: env-gated 프로바이더 라이브 스모크 1콜 + 로컬/CI 검증 정렬'
status: in-progress
created: 2026-07-04
priority: medium
urgency: soon
area: scripts/harness, .github/workflows
depends_on: ['INFRA-026']
---

# env-gated 프로바이더 라이브 스모크 1콜 + 로컬/CI 검증 정렬

Re-audit P2-15 (GATE-005/006). 프로바이더·전송 경계 전부 mock — IPC usage·Anthropic 400·
maxTokens 부류를 수동 라이브만 잡은 전력 3회. 로컬/CI 검증 범위 양방향 불일치. CI job 추가는
사용자 사전 승인 완료(안건 2 포괄).

## What

1. env-gated 라이브 스모크 1콜 스크립트 + 스케줄드 CI job(키 부재 skip).
2. 로컬/CI 비대칭(cli:dev 스모크, pnpm audit) 해소 방안 문서화.

## Test Plan

- 키 존재 실호출 성공 / 부재 skip 실측.

## User Execution Test Scenarios

- agent-executable. 스모크 자체가 라이브 1콜 — 로컬 키 실행 성공 + 키 제거 환경 skip 종료코드
  실측.
- Evidence: 아래 Outcome의 3가지 실측 실행 (skip / live PASS / red proof) 참조.

## Outcome (2026-07-25) — What 1 delivered, What 2 covered elsewhere

### What 1 — 라이브 스모크 + 스케줄드 job: DONE (로컬 실측 완료)

- `scripts/harness/live-provider-smoke.mjs` — credentialed 프로바이더마다 최소 실호출 2건
  (non-streaming `chat()` + streaming `chatStream()`, `maxTokens` 32). 프로바이더 목록과 키
  환경변수 이름을 **프로바이더 정의의 `defaults.apiKey` `$ENV:` 참조에서 읽으므로** 이 스크립트에는
  프로바이더 이름 표가 없다 — 새 프로바이더는 자동으로 커버된다.
- `scripts/harness/__tests__/live-provider-smoke.test.mjs` — 순수 로직(선택/리댁션/판정/리포트)
  단위 테스트 20건. 네트워크 없음.
- `.github/workflows/live-provider-smoke.yml` — 매일 05:37 UTC + `workflow_dispatch`. PR
  게이트가 아니며 required check도 아니다 (mutation-nightly와 동일한 non-blocking 롤아웃 자세).
  미프로비저닝 시크릿은 빈 문자열로 확장 → 해당 프로바이더 skip → exit 0.

**실측 (2026-07-25, 로컬):**

| 시나리오                                      | 명령                                                                       | 결과                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 키 부재 → clean skip                          | `env -u ANTHROPIC_API_KEY node scripts/harness/live-provider-smoke.mjs`    | `SKIPPED — no provider credentials`, **exit 0**                                              |
| 키 존재 → 실호출                              | `node scripts/harness/live-provider-smoke.mjs`                             | `PASS anthropic (model=claude-sonnet-4-6) chat=4 chars, stream=2 chunks/4 chars`, **exit 0** |
| red proof (잘못된 키로 accidental-green 방지) | `ANTHROPIC_API_KEY=<invalid> node scripts/harness/live-provider-smoke.mjs` | `FAIL anthropic … 401 authentication_error`, **exit 1**                                      |

`node scripts/harness/run-all-scans.mjs`: 61개 중 59개 통과. 실패한 `build-contracts` / `dist`는
전체 워크스페이스를 빌드하지 않은 이 환경의 아티팩트이며 이 변경과 무관하다.

### 남은 것 — 소유자가 리포 시크릿을 넣어야 CI 절반이 증명된다

워크플로가 실제로 라이브 호출을 하는 것은 리포 시크릿이 있어야만 관측된다. 그 전까지 이 job은
초록색 no-op(전부 skip)이다. 그래서 이 항목은 `done`이 아니라 `in-progress`로 남는다.

- 필수: `ANTHROPIC_API_KEY` 리포 시크릿 하나만 있어도 CI 절반이 증명된다.
- 선택: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY`.
- OpenAI는 정의에 기본 모델이 없다 → 리포 **variable** `LIVE_SMOKE_MODEL_OPENAI`도 함께 필요하다.
  없으면 FAIL이 아니라 WARN으로 보고된다 (설정 누락으로 나이틀리를 빨갛게 만들지 않는다).
- 프로비저닝 후 `workflow_dispatch`로 1회 수동 실행 → 로그에 `PASS <provider> (model=…)`가
  찍히면 이 항목을 `done`으로 닫고 `completed/`로 옮긴다.

루트 `package.json`은 이 웨이브에서 다른 에이전트 소유라 스크립트를 추가하지 않았다. 나중에 추가할 줄:

```json
"harness:live-smoke": "node scripts/harness/live-provider-smoke.mjs"
```

### What 2 — 로컬/CI 검증 비대칭 문서화: 별도 작업이 커버

같은 웨이브의 `scripts/harness/verify-like-ci.mjs` 작업이 로컬/CI 정렬을 다룬다. 여기서 중복
구현하지 않는다. 이 항목이 닫히려면 그 작업의 결과를 확인해야 한다.
