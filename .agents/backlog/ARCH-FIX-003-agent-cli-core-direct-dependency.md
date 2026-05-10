---
title: 'ARCH-FIX-003: agent-cli의 agent-core 직접 의존 감사 및 SDK 경유로 정규화'
status: wontfix
created: 2026-05-10
priority: high
urgency: soon
area: architecture
related: [V-DEP-002]
---

## Problem

`agent-cli/package.json`이 `@robota-sdk/agent-core`를 직접 의존한다. `agent-system.md` 다이어그램에서 `AgentCLI → Core` 직접 엣지는 존재하지 않으며, CLI는 "Thin product shell only"로 정의되어 있다.

`agent-core` 내부를 CLI가 직접 사용하면 `agent-sdk`(Assembly 레이어)를 우회하는 구조가 된다. 이는 `dependency-direction.md`의 레이어 계층 규칙 위반이다.

## Solution

1. `agent-cli` 소스에서 `@robota-sdk/agent-core` 임포트 전체 목록을 추출한다.
2. 각 심볼이 `agent-sdk`를 통해 이미 노출되는지 확인한다.
3. 노출 가능한 심볼은 `agent-sdk` 경유 임포트로 교체한다.
4. `agent-sdk`에서 노출되지 않는 심볼은 `agent-sdk`의 public API로 추가하거나, SPEC에 직접 의존 예외 근거를 기록한다.
5. 교체 완료 후 `agent-cli/package.json`에서 `agent-core` 직접 의존성을 제거한다.

예외가 불가피한 경우 `agent-cli/docs/SPEC.md`에 명시적 예외 섹션을 추가해 정당성을 기록한다.

## Test Plan

**Closed as wontfix**: "SDK is not a re-export layer" 피드백에 따라 CLI가 core/provider/plugin에서
자유롭게 import하는 것이 허용됨. agent-core 직접 import는 설계상 허용된 패턴이며 위반이 아님.
감사 에이전트가 agent-system.md의 다이어그램 기반으로 위반으로 분류했으나,
실제 프로젝트 규칙과 충돌함.

## User Execution Test Scenarios

### 시나리오: CLI 기본 실행 흐름 정상 동작 확인

**전제 조건**: Node.js 22+, pnpm 빌드 완료

**실행 단계**:

```bash
pnpm build
robota --help
```

**기대 결과**: 도움말 출력 정상, 실행 오류 없음.

**증거**: (구현 후 기록)
