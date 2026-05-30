---
title: 'PLG-008: Visual Agent Code Generator — @robota-sdk/agent-framework 기반 에이전트 앱 조립 도구 (Epic)'
status: done
created: 2026-05-19
completed: 2026-05-20
priority: high
urgency: later
area: apps/agent-web, apps/agent-server, packages/agent-playground
depends_on: []
---

## Background

현재 Playground는 agent 노드 생성 → tool 드래그 → 채팅 실행 흐름을 가지고 있으나,
레거시 아키텍처 위에 얹혀 있어 신뢰성이 낮다.

**핵심 목표**: 새로운 agent 애플리케이션을 만들 때 쓸 수 있는 **코드 생성 도구**다.
사용자가 Visual UI에서 provider, model, tools, skills를 조립하면, 그 조합을 그대로 재현하는
**TypeScript 코드 스니펫**이 생성된다. 이 코드를 새 프로젝트에 붙여넣으면 즉시 동작하는
`@robota-sdk/agent-framework` 기반 에이전트 애플리케이션의 기반이 된다.

**비유**: shadcn/ui CLI가 컴포넌트 코드를 생성해주는 것처럼, 이 도구는 agent application
bootstrap 코드를 생성해준다.

## 하위 백로그 항목

이 항목은 Epic이다. 실제 구현은 다음 하위 항목들에서 진행된다.

### Backend Foundation (선행 작업)

| ID                                               | 제목                                                                       | 우선순위 |
| ------------------------------------------------ | -------------------------------------------------------------------------- | -------- |
| [PLG-018](PLG-018-playground-router-module.md)   | Playground Router Module — /api/playground/\* 전용 라우터 + BYOK sanitizer | medium   |
| [PLG-016](PLG-016-provider-model-catalog-api.md) | Provider & Model Catalog API                                               | medium   |
| [PLG-017](PLG-017-tool-registry-api.md)          | Tool Registry API + 서버사이드 tool 등록                                   | medium   |
| [PLG-015](PLG-015-playground-execution-api.md)   | Playground Execution API — SSE 스트리밍 에이전트 실행                      | high     |

### Frontend Migration & Redesign

| ID                                                  | 제목                                                         | 우선순위 |
| --------------------------------------------------- | ------------------------------------------------------------ | -------- |
| [PLG-009](PLG-009-framework-executor-client.md)     | Framework Executor Client — PlaygroundExecutor SSE 기반 교체 | high     |
| [PLG-010](PLG-010-assembly-canvas-redesign.md)      | Assembly Canvas 재설계 — AgentNode + ToolNode + 엣지 연결    | high     |
| [PLG-011](PLG-011-execution-timeline-separation.md) | Execution Timeline 분리                                      | medium   |
| [PLG-012](PLG-012-code-generator-engine.md)         | Code Generator 엔진 — 캔버스 상태 → TypeScript 코드          | high     |
| [PLG-013](PLG-013-code-export-ui.md)                | Code Export UI — 미리보기 + syntax highlight + Copy 버튼     | high     |
| [PLG-014](PLG-014-skills-support.md)                | Skills Support — Skills 패널 + skill 노드 + Code Export 반영 | medium   |

## 의존 그래프

```
PLG-018 ──┐
PLG-016   ├──→ PLG-015 ──→ PLG-009 ──→ PLG-010 ──→ PLG-011
PLG-017 ──┘                                     └──→ PLG-012 ──→ PLG-013 ──→ PLG-014
```

## 생성 코드 목표 산출물 (Phase 3)

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { getCurrentTimeTool } from '@robota-sdk/agent-tools/current-time';

const session = new InteractiveSession({
  provider: {
    name: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY,
  },
  tools: [getCurrentTimeTool],
  systemPrompt: 'You are a helpful assistant.',
});

const response = await session.run('What time is it in Seoul?');
console.log(response);
```

## Non-Goals

- agent 간 orchestration / multi-agent flow (별도 백로그)
- MCP 서버 연결 UI (후속 작업)
- 저장/불러오기 persistence (로컬스토리지 이후 단계)
- agent-cli 재구현

## Test Plan

각 하위 항목의 Test Plan을 참조. Epic 레벨 통합 검증은 PLG-013 완료 후 진행한다.

## User Execution Test Scenarios

각 하위 항목의 User Execution Test Scenarios를 참조.
Epic 완료 기준: PLG-009 + PLG-010 + PLG-012 + PLG-013 시나리오 모두 통과.
