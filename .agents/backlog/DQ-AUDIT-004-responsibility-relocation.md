---
title: 'DQ-AUDIT-004: 책임 재배치 — agent-cli 세션분석 기능 + agent-transport LLM 네이밍'
status: todo
created: 2026-06-14
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-session, packages/agent-transport, packages/agent-framework
depends_on: []
---

# DQ-AUDIT-004: 책임 재배치 (계층 위반)

기능 로직이 thin shell/transport 계층에 들어가 있다. 근거: 설계 품질 감사.

## 포함 findings

- **DQ-05 (P1) — `ISessionRecord`가 agent-cli에 중복 정의.**
  `agent-cli/src/session-analyzer/types.ts:13`가 store가 쓰는 동일 디스크 파일을 파싱하는데
  canonical `agent-session/src/session-store.ts:15`와 별개 타입. `ISessionHistoryEntry`도 core `IHistoryEntry`
  중복. → canonical import 또는 `Pick`/`extends`.
- **DQ-06 (P1) — 세션 분석 기능 로직(~570줄)이 agent-cli에 거주.**
  `agent-cli/src/session-analyzer/{parser,reporter,session-analyze-command}.ts`가 타이밍 분류/집계라는
  도메인 관측 로직을 구현. agent-cli는 thin shell이어야 함. → 라이브러리 패키지(관측/세션 오너)로 이동,
  CLI는 arg 파싱+출력 와이어링만.
  **주의:** 이 배치는 OBS-001(approved)의 "Decision B"가 의도적으로 내린 것. 단독 번복이 아니라
  **OBS-001 재검토**로 진행 — thin-shell 규칙 vs OBS-001 결정의 충돌을 사용자/설계 컨펌으로 해소해야 함.
- **DQ-07 (P1) — LLM 세션 네이밍 기능이 agent-transport에 박힘.**
  `agent-transport/src/tui/session-naming.ts:5,8,19` — 라이브 `provider.chat()` + 하드코딩 타이틀 프롬프트
  - `MAX_FIRST_MESSAGE_CHARS=200`. 프로토콜 transport가 프롬프트 엔지니어링 정책을 소유. → 세션
    자동 네이밍을 session/framework로 이동, transport는 계약 통해 호출, 프롬프트/한도는 config화.

## Completion Criteria

- [ ] TC-01: agent-cli가 `ISessionRecord`/`IHistoryEntry`를 canonical 오너에서 import (중복 정의 제거)
- [ ] TC-02: 세션 분석 파서/리포터가 라이브러리 패키지로 이동, agent-cli는 와이어링만 (OBS-001 재검토 결정 반영)
- [ ] TC-03: 세션 네이밍 로직이 session/framework로 이동, transport는 계약 호출, 프롬프트 config화
- [ ] TC-04: `robota session analyze` 동작 보존 (기존 OBS-001 시나리오 재실행)
- [ ] TC-05: 영향 패키지 typecheck/test + `pnpm harness:scan` 통과

## Test Plan

| TC-ID    | Test Type     | Approach                                 |
| -------- | ------------- | ---------------------------------------- |
| TC-01~03 | Unit/Static   | 이동 후 단위 테스트 + import 경계 grep   |
| TC-04    | Integration   | session analyze 프로세스 스폰 회귀       |
| TC-05    | Build/Harness | filter typecheck + vitest + harness:scan |

## User Execution Test Scenarios

`robota session analyze` 표면이 있으므로 DQ-06 이동 후 회귀 시나리오 실행 필요:

- 전제: `~/.robota/sessions/`에 세션 JSON 존재
- 실행: `robota session analyze --last 5`
- 기대: 이동 전과 동일한 타이밍 리포트 출력, exit 0
- 증거: 구현 후 명령 출력/exit code 기록 (이동이 동작을 바꾸지 않음을 입증)

DQ-07(세션 네이밍)은 TUI 세션 생성 시 제목 자동 생성이 이동 후에도 동일하게 동작하는지 TUI 액션으로 확인.

## Tasks

- [ ] OBS-001 재검토 — DQ-06 배치 결정 사용자/설계 컨펌
- [ ] DQ-05 타입 통합 → DQ-06 이동 → DQ-07 이동

## Evidence Log
