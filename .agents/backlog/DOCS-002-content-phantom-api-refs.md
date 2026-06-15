---
title: 'DOCS-002: content 가이드의 존재하지 않는 패키지/API 참조 정리'
status: todo
created: 2026-06-16
priority: high
urgency: soon
area: content/guide, content/examples, content/quickstart.md
depends_on: []
---

# DOCS-002: content 존재하지 않는 패키지/API 참조 정리

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

- [ ] TC-01: 위 문서에서 존재하지 않는 패키지명(`plugin-*`, `agent-team`) 및 API(`agent.use`,
      `createAgent`, `SessionStore`, `ROBOTA_*` env) 참조 0건
- [ ] TC-02: 교체된 심볼/옵션이 실제 소스 export와 일치(plugins 배열, createUserSessionStore,
      createAgentRuntime cwd, submit void+complete 이벤트)
- [ ] TC-03: 미구현(team 등)은 "Planned/future"로 표기 또는 제거
- [ ] TC-04: `pnpm harness:scan` 통과

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

- [ ] phantom 참조 교체/Planned 표기 → grep 0건 → harness:scan

## Evidence Log

(구현 후 작성)
