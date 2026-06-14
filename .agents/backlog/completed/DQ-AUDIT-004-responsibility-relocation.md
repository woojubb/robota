---
title: 'DQ-AUDIT-004: 책임 재배치 — agent-cli 세션분석 기능 + agent-transport LLM 네이밍'
status: done
created: 2026-06-14
completed: 2026-06-14
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-session-analytics, packages/agent-transport, packages/agent-framework
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

- [x] OBS-001 재검토 — DQ-06 배치 결정 사용자/설계 컨펌 (제대로 된 아키텍처: 신규 전용 패키지로 승인)
- [x] DQ-05 타입 통합 → DQ-06 이동 → DQ-07 이동

## Evidence Log

### 설계 컨펌 — 2026-06-14

`.design/architecture-audit/2026-06-14/dq-004-005-redesign.md` 작성 후 사용자 승인: "둘 다 승인 —
004→005 순차 구현". OBS-001의 agent-cli 배치는 thin-shell 규칙 위반 → 전용 패키지로 재배치 확정.

### 구현 완료 — 2026-06-14

**DQ-05 + DQ-06 (신규 `@robota-sdk/agent-session-analytics` 패키지):** 세션 로그 타이밍 분석/리포트를
전용 패키지로 추출. 순수 함수(파일 I/O·process 없음), 입력은 `Pick<IInteractiveSessionRecord,
'id'|'cwd'|'createdAt'|'history'>`(SSOT 재사용 — 중복 `ISessionRecord`/`ISessionHistoryEntry` 삭제),
history는 canonical `IHistoryEntry`. agent-cli `session-analyze-command.ts`는 thin wiring으로 축소 —
agent-framework `createUserSessionStore()`(신규)+`createProjectSessionStore()`로 레코드 로드 후 analytics
호출·stdout만. parser/reporter/types 및 unit 테스트는 신규 패키지로 이동(20 테스트).

**DQ-07 (세션 네이밍 → agent-framework):** `generateSessionName`(LLM 기반 제목 생성, 하드코딩 프롬프트)을
agent-transport/tui에서 agent-framework(세션 lifecycle/naming 소유)로 이동. TuiInteractionChannel은
framework에서 import. 매직넘버는 named const화. 테스트 이동(7 테스트).

**검증 증거:**

- 신규 패키지 typecheck+build+test(20), framework test(977, +7 이동), transport test(469, -7 이동),
  cli test(139, command 통합 6 포함). frozen-lockfile 통과. `pnpm harness:scan` **25/25**
  (capability-placement 패턴 추가 + interface-imports 해소), conformance PASS.
- **User Execution Test Scenario (done-gate):** 빌드된 CLI `node bin/robota.cjs session analyze` 실행 —
  fixture 세션에 대해 단일 리포트(LLM API wait 7.8s avg/13.7s max, Tool 300ms, Slow intervals turn 1,
  Verdict 98%/2%) + `--last 5` 집계(Analyzed 1 sessions, Max single delay 13.7s) 정상 출력, **exit 0**.
  이동 전과 동일 동작 확인.

배치 등록: project-structure.md, publish-registry.md, changeset, capability-placement 가드 패턴.
