---
title: 'PLG-012: Code Generator 엔진 — 캔버스 상태 → 실행 가능한 TypeScript 코드 직렬화'
status: todo
created: 2026-05-19
priority: high
urgency: later
area: packages/agent-playground
depends_on: [PLG-010]
---

## Background

PLG-008의 핵심 딜리버러블은 코드 생성이다. 사용자가 캔버스에서 조립한
provider + model + tools + system prompt 설정을 그대로 재현하는 TypeScript 코드를
생성하여 새 프로젝트에 붙여넣으면 바로 동작하는 에이전트 애플리케이션의 기반이 된다.

이 작업은 캔버스 상태(IAssemblyState)를 입력으로 받아 `@robota-sdk/agent-framework`
import 기준의 실행 가능한 TypeScript 코드 스니펫을 출력하는 순수 함수 엔진을 구현한다.

## Goals

1. `IAssemblyState` 타입 정의 (캔버스 직렬화 형태):

   ```typescript
   interface IAssemblyState {
     agent: {
       provider: string; // 'openai'
       model: string; // 'gpt-4o-mini'
       systemPrompt: string;
     };
     tools: string[]; // ['current-time']
   }
   ```

2. `generateAgentCode(state: IAssemblyState): string` 순수 함수 구현:

   ```typescript
   // 출력 예시
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

   const response = await session.run('Your message here');
   console.log(response);
   ```

3. Provider별 import 경로 매핑:
   - `openai` → `process.env.OPENAI_API_KEY`
   - `anthropic` → `process.env.ANTHROPIC_API_KEY`
   - `gemini` → `process.env.GEMINI_API_KEY`

4. Tool별 import 경로 매핑:
   - `current-time` → `@robota-sdk/agent-tools/current-time`
   - (이후 tool 추가 시 registry 확장)

5. System prompt 이스케이프 처리 (템플릿 리터럴 내 backtick, `${}` 이스케이프)

6. `packages/agent-playground/src/lib/code-generator/` 하위에 모듈 배치

7. PLG-016 카탈로그를 활용해 tool import 경로를 동적으로 구성 (하드코딩 최소화)

## Non-Goals

- 생성된 코드의 런타임 실행 (서버사이드 검증)
- skill 조합 코드 생성 (PLG-014에서 추가)
- 다국어 코드 생성 (TypeScript만)

## Architecture

```
packages/agent-playground/src/lib/code-generator/
├── index.ts                  ← generateAgentCode() 공개 API
├── assembly-serializer.ts    ← IAssemblyState → 코드 AST
├── provider-templates.ts     ← provider별 코드 템플릿
├── tool-import-registry.ts   ← tool ID → import 경로 매핑
└── __tests__/
    └── code-generator.test.ts
```

## Test Plan

- 단위 테스트 (`code-generator.test.ts`):
  - OpenAI + current-time → 정확한 TypeScript 스니펫 생성
  - Anthropic provider → ANTHROPIC_API_KEY 환경변수 참조
  - system prompt에 backtick 포함 시 이스케이프 처리
  - tool 없는 경우 → tools 배열 생략
  - 빈 system prompt → systemPrompt 프로퍼티 생략
- `pnpm typecheck && pnpm lint && pnpm test`

## User Execution Test Scenarios

Not applicable — 이 작업은 순수 함수 라이브러리 구현이며 사용자 직접 실행 가능한
UI 표면이 없다. UI 연동은 PLG-013에서 이루어진다.

단위 테스트가 이 작업의 완료 증거다:

- `pnpm --filter @robota-sdk/agent-playground test` 실행 시 code-generator 테스트 전체 통과
