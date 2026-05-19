---
title: 'PLG-017: Tool Registry API — GET /api/playground/catalog/tools + 서버사이드 tool 등록'
status: done
created: 2026-05-19
priority: medium
urgency: soon
area: apps/agent-server, packages/agent-playground
depends_on: [PLG-018]
---

## Background

현재 Playground의 tool 목록은 `packages/agent-playground/src/tools/catalog.ts`에만 존재하며,
서버사이드 실행 시 어떤 tool을 사용할 수 있는지 서버가 알지 못한다.

PLG-015(서버사이드 실행 API)가 tool calling을 처리하려면 서버에도 tool 구현체가 등록되어야 한다.
이 작업은 서버사이드 Tool Registry를 구축하고 프론트엔드가 조회할 수 있는 카탈로그 API를 제공한다.

## Goals

1. `packages/agent-playground/src/tools/` 하위 built-in tool 구현체를 서버사이드에서 재사용 가능한
   형태로 정리 (tool 구현은 순수 TS 함수 — 브라우저/서버 모두에서 동작)
2. `apps/agent-server/src/tools/registry.ts` 생성 — tool ID → 실행 함수 매핑
   ```typescript
   interface IServerToolEntry {
     id: string;
     name: string;
     description: string;
     inputSchema: object; // JSON Schema
     execute: (input: Record<string, unknown>) => Promise<unknown>;
   }
   const toolRegistry = new Map<string, IServerToolEntry>();
   ```
3. `GET /api/playground/catalog/tools` 엔드포인트 구현
   ```typescript
   interface IToolCatalogResponse {
     tools: IToolEntry[];
   }
   interface IToolEntry {
     id: string; // 'current-time'
     name: string; // 'Current Time'
     description: string;
     inputSchema: object; // JSON Schema (파라미터 정의)
     category: string; // 'utility' | 'data' | ...
   }
   ```
4. 초기 등록 tool: `current-time` (추가 tool은 이후 PLG 작업에서 확장)
5. PLG-018 라우터 모듈에 등록
6. PLG-015 실행 API가 이 registry를 통해 tool을 실행하도록 설계

## Non-Goals

- MCP tool 등록 (별도 백로그)
- 사용자 정의 tool 업로드
- tool 실행 결과 캐싱

## Architecture

```
packages/agent-playground/src/tools/
├── current-time/
│   ├── index.ts          ← 메타데이터 (IPlaygroundToolMeta)
│   └── execute.ts        ← 순수 실행 함수 (NEW: 서버/브라우저 공용)

apps/agent-server/src/
└── tools/
    └── registry.ts       ← IServerToolEntry Map + 등록 로직
        └── current-time.ts  ← agent-playground execute.ts 임포트 + 래핑
```

## Test Plan

- 단위 테스트:
  - `toolRegistry.get('current-time')` 등록 확인
  - `execute({})` 호출 → 현재 시각 반환 확인
- 통합 테스트: `GET /api/playground/catalog/tools` curl 응답 검증
- `pnpm typecheck && pnpm lint && pnpm test`

## User Execution Test Scenarios

### Scenario 1: Tool Catalog 조회

**Prerequisites**: `apps/agent-server` 실행 중

**Steps**:

```bash
curl http://localhost:3001/api/playground/catalog/tools | jq .
```

**Expected observable result**:

```json
{
  "tools": [
    {
      "id": "current-time",
      "name": "Current Time",
      "description": "Returns the current date and time",
      "inputSchema": { "type": "object", "properties": {}, "required": [] },
      "category": "utility"
    }
  ]
}
```

**Evidence**: `<curl 출력 캡처 — 구현 후 기입>`
