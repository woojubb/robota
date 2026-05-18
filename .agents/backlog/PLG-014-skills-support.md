---
title: 'PLG-014: Skills Support — Skills 패널 + skill 노드 + Code Export 반영'
status: todo
created: 2026-05-19
priority: medium
urgency: later
area: apps/agent-web, packages/agent-playground
depends_on: [PLG-013]
---

## Background

PLG-013까지는 tools만 지원한다. `@robota-sdk/agent-framework`는 skills도 지원하며,
skill은 에이전트에 특정 행동 패턴(예: 코드 리뷰, 요약, 번역)을 주입하는 단위다.

Visual Agent Code Generator의 완성도를 높이려면 skills도 시각적으로 조립하고
생성 코드에 반영할 수 있어야 한다.

## Goals

1. Skills 카탈로그 정의:
   - `packages/agent-playground/src/skills/catalog.ts` 생성
   - `IPlaygroundSkillMeta` 타입 정의 (IPlaygroundToolMeta와 유사 구조)
   - 초기 등록 skill: placeholder 1~2개 (실제 skill은 agent-framework에서 가져옴)

2. `SkillNode` 커스텀 노드 타입 구현 (ToolNode와 유사):
   - 표시: skill 이름, 설명 요약, 설정 파라미터 수
   - 색상: ToolNode와 시각적으로 구분 (예: 보라색 계열)

3. Skills 패널 추가 (Tools 패널과 동급):
   - 오른쪽 사이드바에 "Tools" / "Skills" 탭 추가
   - 각 skill card에 drag 핸들

4. SkillNode → AgentNode 엣지 연결 → skill 주입:
   - `IAssemblyState`에 `skills: string[]` 추가
   - `injectSkillIntoAgent()` 액션 구현

5. Code Export 반영 (`PLG-012` 코드 생성 엔진 확장):
   - skill이 연결된 경우 import + 설정 코드 생성

   ```typescript
   import { mySkill } from '@robota-sdk/agent-skills/my-skill';

   const session = new InteractiveSession({
     // ...
     skills: [mySkill],
   });
   ```

6. `GET /api/playground/catalog/skills` 엔드포인트 추가 (PLG-017 패턴과 동일):
   - 서버사이드 skill 카탈로그 노출

## Non-Goals

- 커스텀 skill 업로드
- skill 간 의존성 관리
- skill 실행 결과 시각화 (tool call과 별개)

## Architecture

```
packages/agent-playground/src/skills/
├── catalog.ts                ← IPlaygroundSkillMeta 목록
└── (skill 구현체는 @robota-sdk/agent-framework에서 가져옴)

packages/agent-playground/src/components/playground/
├── assembly-canvas/
│   └── nodes/
│       └── skill-node.tsx    ← NEW
└── skills-panel/
    └── skills-panel.tsx      ← NEW (tools-panel과 동일 구조)

packages/agent-playground/src/lib/code-generator/
└── skill-import-registry.ts  ← NEW (tool-import-registry와 동일 패턴)
```

## Test Plan

- 단위 테스트:
  - `generateAgentCode()` — skill 포함 시 올바른 import + skills 배열 생성
  - SkillNode 렌더링 검증
- Playwright E2E:
  - skill 카드 드래그 → AgentNode 연결 → Code Export에 skill 반영 확인
- `pnpm typecheck && pnpm lint && pnpm test`

## User Execution Test Scenarios

### Scenario 1: Skill 조립 + Code Export

**Prerequisites**: PLG-009~PLG-013 완료, `pnpm dev`, skill 1개 이상 등록됨

**Steps**:

1. `http://localhost:7071/playground` 접속
2. 에이전트 생성 → Skills 패널 탭 클릭
3. skill 카드를 캔버스로 드래그 → AgentNode에 연결
4. "Code Export" 탭 클릭

**Expected observable result**:

- 생성 코드에 skill import 및 `skills: [...]` 배열 포함
- Assembly Canvas에 SkillNode가 AgentNode에 연결된 상태로 표시
- SkillNode 색상이 ToolNode와 시각적으로 구분됨

**Evidence**: `<스크린샷 + 생성 코드 캡처 — 구현 후 기입>`
