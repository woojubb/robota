---
title: 'PLG-016: Provider & Model Catalog API — GET /api/playground/catalog/providers'
status: done
created: 2026-05-19
priority: medium
urgency: soon
area: apps/agent-server
depends_on: [PLG-018]
---

## Background

현재 Playground UI는 사용 가능한 provider와 model 목록을 프론트엔드 코드에 하드코딩하고 있다.
서버에 어떤 provider 키가 설정되어 있는지, 어떤 모델이 지원되는지 알 수 없어
"Create Agent" 폼이 서버 실제 상태와 불일치하는 문제가 있다.

이 작업은 프론트엔드가 서버에 사용 가능한 provider + model 목록을 동적으로 조회할 수 있는
카탈로그 API를 제공한다. BYOK 사용자는 서버 키 없이 직접 키를 입력할 수 있음도 표시한다.

## Goals

1. `GET /api/playground/catalog/providers` 엔드포인트 구현
2. 응답 스키마:
   ```typescript
   interface IProviderCatalogResponse {
     providers: IProviderEntry[];
   }
   interface IProviderEntry {
     id: string; // 'openai' | 'anthropic' | 'gemini' | 'deepseek'
     name: string; // 'OpenAI' | 'Anthropic' | ...
     serverKeyAvailable: boolean; // 서버에 API 키 환경변수가 설정된 경우 true
     byokSupported: boolean; // BYOK 허용 여부 (PLG-015 구현 시 true)
     models: IModelEntry[];
   }
   interface IModelEntry {
     id: string; // 'gpt-4o-mini'
     name: string; // 'GPT-4o Mini'
     contextWindow: number; // 128000
     supportsTools: boolean; // tool calling 지원 여부
   }
   ```
3. 서버 키 노출 금지: `serverKeyAvailable: true`만 반환, 키 값 자체는 절대 포함하지 않음
4. PLG-018 라우터 모듈에 등록
5. 프론트엔드 "Create Agent" 폼이 이 API를 사용하도록 업데이트 (agent-playground 내 하드코딩 제거)

## Non-Goals

- 모델 목록 실시간 동기화 (AI 제공업체 API에서 live fetch) — 정적 목록으로 시작
- 모델 가격 정보
- 사용자별 provider 설정

## Test Plan

- 단위 테스트:
  - 각 환경변수 조합에서 `serverKeyAvailable` 값이 올바른지 확인
  - 응답 스키마 타입 검증
- 통합 테스트: `GET /api/playground/catalog/providers` curl 응답 검증
- `pnpm typecheck && pnpm lint && pnpm test`

## User Execution Test Scenarios

### Scenario 1: Provider Catalog 조회

**Prerequisites**: `apps/agent-server` 실행 중, `OPENAI_API_KEY` 환경변수 설정됨

**Steps**:

```bash
curl http://localhost:3001/api/playground/catalog/providers | jq .
```

**Expected observable result**:

```json
{
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "serverKeyAvailable": true,
      "byokSupported": true,
      "models": [
        { "id": "gpt-4o", "name": "GPT-4o", "contextWindow": 128000, "supportsTools": true },
        { "id": "gpt-4o-mini", "name": "GPT-4o Mini", "contextWindow": 128000, "supportsTools": true }
      ]
    },
    {
      "id": "anthropic",
      "name": "Anthropic",
      "serverKeyAvailable": false,
      "byokSupported": true,
      "models": [...]
    }
  ]
}
```

- `openai.serverKeyAvailable: true` (키 설정됨)
- `anthropic.serverKeyAvailable: false` (키 없음)
- 응답에 실제 키 값 없음

**Evidence**: `<curl 출력 캡처 — 구현 후 기입>`
