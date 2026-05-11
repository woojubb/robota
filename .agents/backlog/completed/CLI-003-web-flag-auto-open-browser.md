---
title: 'CLI-003: --web 플래그 진입 시 브라우저 자동 오픈'
status: done
created: 2026-05-10
priority: medium
urgency: soon
area: cli
source: plg-002-cli-web-monitor
---

## Problem

`robota --web` 으로 CLI를 실행하면 WebSocket 사이드카 서버(포트 7070)가 뜨지만,
사용자가 직접 `http://localhost:7071/monitor` 를 브라우저에 입력해야 한다.
`--web` 플래그 자체가 웹 UI 사용 의사 표현이므로 추가 단계가 불필요한 마찰이다.

## Required Change

`--web` 플래그 진입 시 사이드카 서버가 준비된 직후 브라우저를 자동으로 연다.

**조건:**

- `--web` 단독 → 브라우저 자동 오픈 + 터미널에 URL 출력
- `--web --no-open` → 서버만 시작, URL만 터미널에 출력 (헤드리스/CI 환경용)
- `ROBOTA_NO_OPEN=1` 환경변수 → `--no-open`과 동일하게 동작

**구현 위치:**

- `packages/agent-cli/src/utils/cli-args.ts` — `--no-open` 플래그 파싱 추가
- `packages/agent-cli/src/commands/` (또는 CLI 진입점) — 사이드카 서버 ready 후 `open()` 호출
- `open` 패키지(Node.js cross-platform browser launcher) 사용; 이미 의존성에 없으면 추가

**URL 규칙:**

- 오픈 대상: `http://localhost:<webPort>/monitor` (`webPort` = Next.js 앱 포트, 기본 7071)
- 사이드카 포트(7070)가 아님에 주의

## Test Plan

- [ ] `--no-open` 플래그가 `IParsedCliArgs`에 파싱되는지 단위 테스트
- [ ] `ROBOTA_NO_OPEN=1` 환경변수 분기 단위 테스트
- [ ] `open()` 호출이 서버 ready 이후에 발생하는지 통합 확인
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` 통과

## User Execution Test Scenarios

### Scenario 1: --web 자동 오픈

**Prerequisites:**

- `apps/agent-web` Next.js 앱이 포트 7071에서 실행 중 (`pnpm --filter agent-web dev`)
- CLI 빌드 완료 (`pnpm --filter @robota-sdk/agent-cli build`)

**Steps:**

```bash
robota --web
```

**Expected observable result:**

- 터미널에 `WebSocket server listening on ws://localhost:7070` 출력
- 터미널에 `Opening browser: http://localhost:7071/monitor` 출력
- 브라우저가 자동으로 열리고 Monitor 페이지(`http://localhost:7071/monitor`)가 표시됨
- 연결 상태 표시기가 "connected" (에메랄드 색)로 나타남

**Evidence:** _(구현 후 작성)_

---

### Scenario 2: --no-open 억제

**Prerequisites:** Scenario 1과 동일

**Steps:**

```bash
robota --web --no-open
```

**Expected observable result:**

- 터미널에 URL 출력 (`http://localhost:7071/monitor`)
- 브라우저가 자동으로 열리지 않음

**Evidence:** _(구현 후 작성)_

---

### Scenario 3: ROBOTA_NO_OPEN 환경변수 억제

**Prerequisites:** Scenario 1과 동일

**Steps:**

```bash
ROBOTA_NO_OPEN=1 robota --web
```

**Expected observable result:**

- Scenario 2와 동일: 브라우저 자동 오픈 없음, URL만 터미널에 출력

**Evidence:** _(구현 후 작성)_
