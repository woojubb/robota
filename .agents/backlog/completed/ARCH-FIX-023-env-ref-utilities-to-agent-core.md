---
title: 'ARCH-FIX-023: $ENV: 참조 유틸리티(env-ref)를 agent-sdk → agent-core로 이동'
status: backlog
created: 2026-05-14
priority: high
urgency: later
area: agent-sdk, agent-core
related: [ARCH-FIX-021, ARCH-FIX-022]
---

## 레이어 위반 내용

`agent-sdk/src/command-api/provider/provider-env-ref.ts`에 외부 의존성이 전혀 없는 순수 유틸리티 4개가 있다.

| 함수                                                            | 내용                                     | 현재      | 올바른 목적지  |
| --------------------------------------------------------------- | ---------------------------------------- | --------- | -------------- |
| `isEnvReference(value: string): boolean`                        | `$ENV:` 접두사 여부 판별                 | agent-sdk | **agent-core** |
| `formatEnvReference(name: string): string`                      | `$ENV:<name>` 형식 문자열 생성           | agent-sdk | **agent-core** |
| `resolveEnvReference(value: string): string \| undefined`       | `$ENV:<name>` → `process.env[name]` 해소 | agent-sdk | **agent-core** |
| `hasUsableSecretReference(value: string \| undefined): boolean` | 값이 유효한 env 참조인지 확인            | agent-sdk | **agent-core** |

이 함수들은:

- `process.env` 와 문자열 조작만 사용 (외부 패키지 의존 없음)
- 환경 변수 참조 포맷 `$ENV:<name>` 을 정의하는 도메인 규칙
- 모든 패키지가 공통으로 필요할 수 있는 기초 유틸리티

`agent-core`는 "Foundation contracts, engine, events, hooks, permissions"를 소유하며 zero-dep 정책을 유지한다.
환경 변수 참조 포맷과 해소 로직은 도메인 계약의 일부로 `agent-core`에 위치해야 한다.

## 이동 범위

```
이동 전: agent-sdk/src/command-api/provider/provider-env-ref.ts
이동 후: agent-core/src/env-ref.ts
```

- `agent-core/src/index.ts`에서 4개 함수 + `ENV_REFERENCE_PREFIX` 상수 export
- `agent-sdk/src/command-api/provider/provider-env-ref.ts` 삭제
- `agent-sdk`의 기존 소비자: `agent-sdk/index.ts`, `agent-sdk/commands/index.ts`, `agent-sdk/command-api/index.ts`, `agent-sdk/command-api/model/model-command-api.ts`, `agent-sdk/command-api/provider/provider-settings.ts` → `@robota-sdk/agent-core`에서 re-import
- `agent-cli/src/utils/env-ref.ts` (agent-sdk 재export 파일) → `@robota-sdk/agent-core`에서 직접 import

## 전략적 중요성

이 이동 완료 후 다음 백로그 작업이 더 낮은 레이어로 내려갈 수 있다:

| 백로그           | 현재 목적지 | ARCH-FIX-023 이후 가능 목적지                                               |
| ---------------- | ----------- | --------------------------------------------------------------------------- |
| [[ARCH-FIX-022]] | agent-sdk   | **agent-core** (모든 deps가 agent-core)                                     |
| [[ARCH-FIX-021]] | agent-sdk   | **agent-runtime** (R-1 확인 후, TProviderSettingsDocument도 내릴 수 있다면) |

## 수용 기준

- [ ] `isEnvReference`, `formatEnvReference`, `resolveEnvReference`, `hasUsableSecretReference`가 `agent-core`에서 export
- [ ] `agent-sdk/src/command-api/provider/provider-env-ref.ts` 삭제
- [ ] `agent-sdk`, `agent-cli` 소비자가 `@robota-sdk/agent-core`에서 import
- [ ] `pnpm typecheck && pnpm lint && pnpm test` 전 범위 통과

## Test Plan

- Unit: 4개 함수의 기존 동작 유지 (`$ENV:`, 비어있는 값, 미설정 환경변수 케이스)
- Lint: `agent-sdk`에 env-ref 구현 없음 (re-export 포함 금지)

## User Execution Test Scenarios

Not applicable — 내부 이동이며 사용자 노출 동작 변화 없음.

## 의존 관계

- 선행 의존 없음 — 독립적으로 실행 가능
- 완료 후 [[ARCH-FIX-021]], [[ARCH-FIX-022]] 목적지 결정에 영향
