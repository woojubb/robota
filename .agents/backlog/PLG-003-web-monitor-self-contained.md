---
title: 'PLG-003: --web 모니터 자급 실행 — Next.js 외부 서버 의존성 제거'
status: backlog
created: 2026-05-10
priority: medium
urgency: later
area: agent-cli
---

## Problem

현재 `robota --web` 실행 시 WS sidecar 서버(포트 7070)는 올라오고 브라우저도 열리지만,
`http://localhost:7071/monitor` 페이지가 표시되려면 `apps/agent-web` Next.js 개발 서버가
**별도로** 실행 중이어야 한다.

사용자 입장에서는 `robota --web` 하나로 모니터 화면이 떠야 하는데,
Next.js 서버를 따로 띄워야 한다는 조건은 제품 UX로 수용 불가능하다.

## Considered Approaches

### Option A: React SPA 번들을 agent-cli에 내장 (권장)

- `apps/agent-web`(또는 신규 패키지)를 Vite/esbuild로 순수 React SPA로 빌드
- 빌드 산출물(`index.html` + JS/CSS 번들)을 `packages/agent-cli/dist/web/`에 포함
- CLI sidecar 서버(`web-sidecar-server.ts`)에 정적 파일 서빙 기능 추가
- `--web` 플래그 사용 시 sidecar가 7070 포트에서 WS + 정적 파일 모두 서빙
- Next.js, 외부 서버, 별도 프로세스 불필요

**장점:**

- 단일 프로세스, 단일 포트, 완전 자급
- npm 배포 시 `dist/web/` 포함으로 설치만으로 동작
- Node.js `http` + `ws` 만으로 구현 가능 (이미 sidecar에 `ws` 사용 중)

**단점:**

- agent-cli 빌드 파이프라인에 SPA 빌드 스텝 추가 필요
- `tsup` → SPA 빌드 분리 또는 추가 스크립트 필요

### Option B: agent-cli에서 Next.js 프로세스 자동 spawn

- `--web` 시 `apps/agent-web`을 `child_process.spawn`으로 자동 실행
- CLI 종료 시 자식 프로세스도 정리

**단점:**

- `apps/agent-web`이 `node_modules`에 설치된 상태가 아니면 동작 불가
- npm 패키지로 배포 불가능한 구조

### Option C: 현재 구조 유지 + 사용자 안내

- `--web` 실행 시 "별도로 `apps/agent-web`을 실행하세요" 메시지 표시

**단점:** UX 미완성으로 수용 불가

## Recommendation

**Option A**를 채택한다. sidecar 서버가 이미 `ws` 기반으로 동작 중이므로,
정적 파일 서빙만 추가하면 된다. SPA 빌드는 Vite를 사용해 `packages/agent-web`(또는
신규 `packages/agent-web-ui`)에서 독립적으로 처리한다.

## Scope

- `packages/agent-web` (또는 신규 `packages/agent-web-ui`): Vite SPA 빌드 구성 추가
- `packages/agent-cli/src/web-sidecar/web-sidecar-server.ts`: 정적 파일 서빙 추가
- `packages/agent-cli/package.json`: 빌드 스크립트에 SPA 빌드 연동
- `packages/agent-cli/tsup.config.ts` (또는 빌드 스크립트): `dist/web/` 산출물 포함

## Test Plan

- `pnpm --filter @robota-sdk/agent-cli build` 후 `dist/web/index.html` 존재 확인
- `robota --web` 실행 후 포트 7070에서 `GET /` → `index.html` 반환 확인
- `pnpm typecheck` 통과
- WS 연결 + 정적 서빙이 같은 포트(7070)에서 동작함을 확인

## User Execution Test Scenarios

### Scenario 1: --web 단독 실행으로 모니터 페이지 표시

**Prerequisites:**

- `robota` CLI가 PATH에 등록되어 있거나 `pnpm dev` 실행 가능
- 별도 Next.js 서버 실행 없음

**Steps:**

1. `robota --web` 실행 (또는 `pnpm dev -- --web`)
2. 브라우저가 자동으로 열리거나 `http://localhost:7070` 수동 접속

**Expected result:**

- Next.js 서버 없이 모니터 UI 페이지가 정상 표시됨
- CLI에서 메시지를 입력하면 브라우저 화면에 실시간 반영됨

**Evidence:** (구현 후 스크린샷 또는 녹화 첨부)
