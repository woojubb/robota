---
title: 'DOCS-008: content 가이드의 존재하지 않는 패키지/API 참조 정리'
status: done
created: 2026-06-16
completed: 2026-06-16
priority: high
urgency: soon
area: content/guide, content/examples, content/quickstart.md
depends_on: []
---

# DOCS-008: content 존재하지 않는 패키지/API 참조 정리

## Problem

여러 가이드가 존재하지 않는 패키지/API를 현재형으로 기술해 따라하면 실패한다. 근거:
`.design/docs-audit/2026-06-16/report-content-core-guides.md`, `report-content-examples-integrations.md`.

- `content/guide/cli.md` (~305–347): 가공의 `@robota-sdk/plugin-{github,slack,jira,linear,notion}` +
  `GitHubPlugin` + `agent.use(...)`. 실제: `@robota-sdk/agent-plugin`의 8개 플러그인, 생성자
  `plugins: [...]` 등록. `Robota.use()` 없음.
- `content/guide/migration.md` (~26, 227–243): 존재하지 않는 `@robota-sdk/agent-team`
  (`createTeam`/`TeamContainer`/`agent.addTool()`) + 죽은 SPEC 링크.
- `content/guide/local-llm.md` (~66–72): 존재하지 않는 `ROBOTA_PROVIDER/BASE_URL/MODEL/API_KEY`
  환경변수 설정법. 실제: `robota --configure` / settings.json.
- `content/examples/session-management.md`: `SessionStore` import/`new SessionStore()` — 미export.
  실제: `createUserSessionStore()` / `createProjectSessionStore()`.
- `content/quickstart.md` (~68–77): `createAgentRuntime({ provider })`가 필수 `cwd` 누락;
  `const response = await session.submit(...)`는 오류(`submit()` → `Promise<void>`). 응답은
  `complete` 이벤트 또는 `createQuery()`.

## Solution

각 항목을 실제 export/패턴으로 교체하거나, 미구현 기능은 "Planned"로 명확히 분리. 코드 샘플은
실제 패키지 export와 일치하도록 수정.

## Completion Criteria

- [x] TC-01: 위 문서에서 존재하지 않는 패키지명(`plugin-*`, `agent-team`) 및 API(`agent.use`,
      `createAgent`, `SessionStore`, `ROBOTA_*` env) 참조 0건
- [x] TC-02: 교체된 심볼/옵션이 실제 소스 export와 일치(plugins 배열, createUserSessionStore,
      createAgentRuntime cwd, submit void+complete 이벤트)
- [x] TC-03: 미구현(team 등)은 "Planned/future"로 표기 또는 제거
- [x] TC-04: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type  | Approach                                              |
| ----- | ---------- | ----------------------------------------------------- |
| TC-01 | Doc/grep   | 존재하지 않는 식별자 grep → 0건                       |
| TC-02 | Doc review | 소스 export(`agent-plugin`, `agent-framework`)와 대조 |
| TC-03 | Doc review | Planned 표기 확인                                     |
| TC-04 | Harness    | `pnpm harness:scan`                                   |

## User Execution Test Scenarios

quickstart.md / session-management.md는 사용자 실행 절차다. 수정 후 해당 스니펫이 현재 API로
타입체크/빌드되는지 확인. migration/local-llm/cli의 미구현·설정 서술은 prose/Planned라 Not applicable.

## Tasks

- [x] phantom 참조 교체/Planned 표기 → grep 0건 → harness:scan

## Evidence Log

### 구현 완료 — 2026-06-16

- **cli.md:** 가공 `@robota-sdk/plugin-{github,…}` + `agent.use()` 섹션을 실제 8개 플러그인
  (`@robota-sdk/agent-plugin`, 생성자 `plugins: []` 등록)으로 교체. "there is no `agent.use()`" 명시.
- **migration.md:** `agent-team`을 "removed"로 표기, 가공 relay-tool 코드·죽은 SPEC 링크 제거,
  subagent 디스패치 안내로 교체. 요약 표 행 정정.
- **local-llm.md:** 존재하지 않는 `ROBOTA_*` env 블록 제거 → settings.json/`--configure` 안내.
- **session-management.md:** `new SessionStore()` → `createUserSessionStore()`(실제 export).
- **quickstart.md:** `createAgentRuntime`+`session.submit()`(void) → `createQuery({ provider })` 두 블록 교체.
- **TC-01~04:** 가공 식별자 grep 0건(남은 매치는 "no longer available"/"there is no…" 부정문), 교체 심볼이
  실제 export와 일치, `pnpm harness:scan` **26/26 passed**.
