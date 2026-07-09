---
title: 'PLG-F-001: 코드 생성 엔진 — createQuery / InteractiveSession 기반 코드 생성'
status: todo
created: 2026-05-19
priority: high
urgency: now
area: packages/agent-playground
depends_on: []
---

## Background

현재 Code Export는 `@robota-sdk/agent-core`의 `Robota` 클래스 기반 코드를 생성한다.
`Robota`는 저수준 단발성 실행 클래스이며, `agent-framework`가 제공하는
멀티턴 대화·스킬·플러그인·세션 관리 기능을 전혀 표현하지 못한다.

실제 SDK 사용자는 `@robota-sdk/agent-framework`의 `createQuery()` 또는
`InteractiveSession`을 사용해야 한다.

```typescript
// 현재 생성 코드 (잘못된 추상화 수준)
import { Robota } from '@robota-sdk/agent-core';
const robota = new Robota({ ... });
const response = await robota.run('...');

// 목표: createQuery (단순 에이전트)
import { createQuery } from '@robota-sdk/agent-framework';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const query = createQuery({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
});
const response = await query('Your message here');
console.log(response);

// 목표: InteractiveSession (도구·스킬 포함 에이전트)
import { InteractiveSession, createBuiltinCommandModule } from '@robota-sdk/agent-framework';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
  permissionMode: 'bypassPermissions',
  commandModules: [createBuiltinCommandModule()],
});
await session.submit('Your message here');
await session.shutdown();
```

## Goals

1. `IAssemblyState`에서 어떤 수준의 코드를 생성할지 결정하는 로직 구현:
   - 도구·스킬 없음 → `createQuery` 패턴 생성
   - 도구·스킬 존재 → `InteractiveSession` 패턴 생성

2. `createQuery` 코드 생성:
   - `@robota-sdk/agent-framework`에서 `createQuery` import
   - provider import + apiKey 환경변수
   - `systemPrompt`가 있을 경우: `createQuery({ provider, systemPrompt })` 형태

3. `InteractiveSession` 코드 생성:
   - `InteractiveSession` + `createBuiltinCommandModule` import
   - `cwd: process.cwd()` 기본값
   - `permissionMode: 'bypassPermissions'` (프로그래밍 사용 기본값)
   - tools가 있으면: tool import + 등록 방법 주석 포함
   - skills가 있으면: `SkillCommandSource` 또는 인라인 skill 설정 코드 포함
   - `await session.submit('...')` + `await session.shutdown()` 패턴

4. 기존 `Robota` 기반 코드 생성 로직 제거 (하위 호환성 불필요, 미배포 프로젝트)

5. `assembly-serializer.ts` 및 관련 테스트 업데이트

## Non-Goals

- REPL/멀티턴 코드 생성 (단일 submit 패턴으로 충분)
- 브라우저 실행 코드 생성 (Node.js 환경 기준)

## Architecture

```
packages/agent-playground/src/lib/code-generator/
├── index.ts                    ← IAssemblyState (변경: skills 타입 개선)
├── assembly-serializer.ts      ← 핵심 로직 교체
│   ├── buildCreateQueryCode()  ← 단순 에이전트용
│   └── buildInteractiveSessionCode()  ← 도구·스킬 포함용
├── provider-templates.ts       ← 변경 없음 (provider import 재사용)
└── tool-import-registry.ts     ← 변경 없음
```

## Test Plan

- 단위 테스트:
  - 도구·스킬 없음 → `createQuery` 패턴 생성 확인
  - 도구 포함 → `InteractiveSession` 패턴 생성 확인
  - `createQuery` import 경로 `@robota-sdk/agent-framework` 확인
  - systemPrompt 있을 때 올바르게 포함되는지 확인
- `pnpm typecheck && pnpm test`

## User Execution Test Scenarios

### Scenario 1: 단순 에이전트 — createQuery 코드 생성

**Prerequisites**: 서버 실행, 에이전트 생성 (도구·스킬 없음)

**Steps**:

1. `http://localhost:7071/playground` 접속
2. 에이전트 생성 (OpenAI, gpt-4o-mini, system message 있음)
3. "Code Export" 탭 클릭

**Expected observable result**:

- 생성 코드에 `import { createQuery } from '@robota-sdk/agent-framework'` 포함
- `new Robota` 없음
- `createQuery({ provider, ... })` 패턴 포함
- `systemPrompt` 설정 포함

**Evidence**: `<스크린샷 — 구현 후 기입>`

### Scenario 2: 도구 포함 에이전트 — InteractiveSession 코드 생성

**Prerequisites**: 에이전트 생성 후 Current Time 도구 드래그 추가

**Steps**:

1. 에이전트 생성 → Current Time 도구 드래그
2. "Code Export" 탭 클릭

**Expected observable result**:

- `import { InteractiveSession } from '@robota-sdk/agent-framework'` 포함
- `new InteractiveSession({ ... })` 패턴
- `await session.submit('...')` 및 `await session.shutdown()` 포함

**Evidence**: `<스크린샷 — 구현 후 기입>`
