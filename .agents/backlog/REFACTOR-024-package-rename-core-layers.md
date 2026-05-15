---
title: 'REFACTOR-024: 핵심 레이어 패키지 이름 변경 (4개)'
status: backlog
created: 2026-05-15
priority: high
urgency: soon
area: packages/agent-sdk, packages/agent-runtime, packages/agent-sessions, packages/agent-web
---

## Problem

현재 패키지 이름이 실제 역할을 잘못 표현하거나 일관성이 없다.

| 현재 이름        | 문제                                                                                | 확정 이름         |
| ---------------- | ----------------------------------------------------------------------------------- | ----------------- |
| `agent-sdk`      | "SDK"는 외부 배포 라이브러리 암시. 실제 역할은 내부 assembly layer                  | `agent-framework` |
| `agent-runtime`  | 시스템 전체 런타임처럼 들림. 실제 역할은 백그라운드 태스크·서브에이전트 실행 인프라 | `agent-executor`  |
| `agent-sessions` | 복수형. `agent-core`, `agent-cli` 등 다른 패키지는 단수                             | `agent-session`   |
| `agent-web`      | 너무 범용적. 양방향 브라우저 UI임이 드러나지 않음                                   | `agent-web-ui`    |

## Scope

### 변경 내용

각 패키지마다:

1. 디렉토리 이름 변경 (`packages/agent-sdk/` → `packages/agent-framework/`)
2. `package.json`의 `name` 필드 변경 (`@robota-sdk/agent-sdk` → `@robota-sdk/agent-framework`)
3. 모노레포 전체에서 해당 패키지를 import하는 모든 `package.json` `dependencies` 업데이트
4. 소스 코드 내 import 경로 업데이트 (`from '@robota-sdk/agent-sdk'` 등)
5. 각 패키지의 `docs/SPEC.md` 패키지명 업데이트
6. 아키텍처 맵 문서 업데이트 (`.agents/specs/architecture-map/`)
7. `project-structure.md` 업데이트
8. `README.md` 업데이트

### 영향 범위 추정

- `agent-framework` (구 `agent-sdk`): import하는 패키지가 가장 많음 — `agent-command-*` 19개, `agent-cli`, `agent-transport-*` 5개 등 약 30개+ 패키지
- `agent-executor` (구 `agent-runtime`): `agent-sdk`, `agent-cli` 등 소수
- `agent-session` (구 `agent-sessions`): `agent-sdk`, `agent-cli` 등 소수
- `agent-web-ui` (구 `agent-web`): `apps/agent-web` 참조, `agent-cli` 등

### 작업 순서

의존성이 적은 것부터 먼저 처리:

1. `agent-sessions` → `agent-session`
2. `agent-runtime` → `agent-executor`
3. `agent-web` → `agent-web-ui`
4. `agent-sdk` → `agent-framework` (마지막, 소비자 가장 많음)

## Test Plan

- `pnpm install` — workspace 링크 정상
- `pnpm build` — 전체 빌드 통과
- `pnpm typecheck` — 전체 통과
- `pnpm test` — 전체 통과
- `pnpm harness:scan` — 이상 없음
- `grep -r "agent-sdk\|agent-runtime\|agent-sessions\|packages/agent-web" --include="*.ts" --include="*.json" packages apps` — 구 이름 잔존 없음

## User Execution Test Scenarios

### 시나리오: CLI 정상 실행 확인

**전제조건**: 리네임 완료 후 전체 빌드 성공.

**단계**:

1. `pnpm build` 실행 후 성공 확인
2. `node packages/agent-cli/dist/node/index.js` 또는 로컬 빌드로 `robota` 실행
3. TUI 진입 확인, 기본 프롬프트 입력 및 응답 확인

**기대 결과**: 패키지 이름 변경 전과 동일하게 CLI가 정상 실행됨.

**Evidence**: `[실행 후 기록]`
