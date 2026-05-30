---
title: 'PLG-F-005: 세션 관리 UI — 세션 저장/복원/목록'
status: todo
created: 2026-05-19
priority: medium
urgency: soon
area: packages/agent-playground, apps/agent-server
depends_on: [PLG-F-002]
---

## Background

`InteractiveSession`은 `.robota/sessions/` 에 세션을 파일로 저장·복원하는 기능을 내장한다.
현재 Playground는 페이지를 새로 고침하면 대화 기록이 사라진다.

세션 저장/복원 기능을 Playground UI에 노출하면 사용자가 이전 대화를 이어갈 수 있고,
여러 실험을 병렬로 저장·비교할 수 있다.

## Goals

1. 서버 세션 영속성:
   - `InteractiveSession` 생성 시 `createProjectSessionStore({ cwd })` 주입
   - 서버 재시작 후에도 세션 복원 가능 (`.robota/sessions/` 파일 기반)
   - `POST /api/playground/sessions` 응답에 `sessionId` 포함

2. `GET /api/playground/sessions` — 저장된 세션 목록:
   - `listResumableSessionSummaries()` 활용
   - 응답: `[{ id, name, createdAt, lastActiveAt, messageCount }]`

3. 세션 복원:
   - `POST /api/playground/sessions` 요청에 `resumeSessionId` 옵션 지원
   - 복원된 세션의 conversation history를 클라이언트에 전달

4. Playground UI — 세션 히스토리 드롭다운:
   - 헤더 또는 에이전트 설정 영역에 "Sessions" 드롭다운
   - 저장된 세션 목록 표시 → 클릭 시 세션 복원
   - 현재 세션 이름 지정 기능 (세션 이름 편집)

5. 세션 삭제:
   - `DELETE /api/playground/sessions/:id`
   - UI: 세션 목록에서 삭제 버튼

## Non-Goals

- 세션 공유 (다른 사용자와 공유)
- 세션 브랜칭/포킹 UI (fork 기능은 서버에 있지만 UI 미노출)
- 세션 내보내기 (JSON 다운로드)

## Architecture

```
apps/agent-server/src/
├── session/
│   └── session-manager.ts   ← createProjectSessionStore 주입 추가
└── routes/handlers/
    ├── session-list.ts       ← NEW: GET /sessions
    └── session-create.ts     ← resumeSessionId 옵션 추가

packages/agent-playground/src/
├── components/playground/
│   └── session-panel/
│       ├── session-dropdown.tsx  ← NEW: 세션 목록 드롭다운
│       └── session-name-editor.tsx ← NEW: 세션 이름 편집
└── hooks/
    └── use-session-list.ts   ← NEW: 세션 목록 조회 훅
```

## Test Plan

- 단위 테스트:
  - `GET /sessions` 응답 스키마 검증
  - `resumeSessionId` 포함 세션 생성 흐름
- `pnpm typecheck && pnpm test`

## User Execution Test Scenarios

### Scenario 1: 세션 저장 및 목록 확인

**Prerequisites**: PLG-F-002 완료, 에이전트 생성 후 대화 1회 이상

**Steps**:

1. 대화 후 페이지 새로 고침
2. 세션 드롭다운 클릭

**Expected observable result**:

- 이전 세션이 목록에 표시됨 (이름, 시간, 메시지 수)

**Evidence**: `<스크린샷 — 구현 후 기입>`

### Scenario 2: 세션 복원

**Steps**:

1. 세션 목록에서 이전 세션 클릭

**Expected observable result**:

- 채팅창에 이전 대화 기록이 복원됨
- 새 메시지를 보내면 이전 맥락 유지한 응답

**Evidence**: `<스크린샷 — 구현 후 기입>`
