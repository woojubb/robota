---
title: 'PLG-F-003: Skills 시스템 재설계 — SKILL.md 기반 실제 스킬'
status: todo
created: 2026-05-19
priority: medium
urgency: soon
area: packages/agent-playground, apps/agent-server
depends_on: [PLG-F-002]
---

## Background

현재 Skills는 시스템 프롬프트 텍스트 추가 수준이다 (`systemPromptAddition` 필드).
`agent-framework`의 실제 스킬 시스템은 SKILL.md 파일 기반이다:

```
skills/
  code-reviewer/
    SKILL.md       ← frontmatter + skill 지시 내용
  summarizer/
    SKILL.md
```

SKILL.md는 frontmatter(`name`, `description`, `argument-hint`, `disable-model-invocation` 등)와
실제 skill 지시 내용(마크다운)으로 구성된다. InteractiveSession은 이를
`SkillCommandSource`를 통해 `/skills <name>` 커맨드로 활성화한다.

Playground가 agent-framework 수준의 playground가 되려면 스킬도 이 형식으로
정의·전달·코드 생성되어야 한다.

## Goals

1. `IPlaygroundSkillMeta` 타입 변경:
   - 기존: `systemPromptAddition: string`
   - 변경: `skillMdContent: string` (전체 SKILL.md 마크다운 문자열)
   - `frontmatter` 파싱: name, description, argument-hint 추출

2. Skills 카탈로그 업데이트:
   - 기존 2개 placeholder skill을 실제 SKILL.md 형식으로 재작성
   - `Code Reviewer`, `Summarizer` SKILL.md 내용 정의

3. Playground UI — SKILL.md 뷰어:
   - Skills 패널 카드에 "View SKILL.md" 버튼
   - 클릭 시 모달에 마크다운 렌더링 (raw + rendered 탭)
   - 선택적: 인라인 편집 모드

4. 코드 생성 업데이트 (PLG-F-001 이후):
   - skill이 있을 때 `SkillCommandSource` 또는 `SkillsCommandModule` 사용 코드 생성

   ```typescript
   import { InteractiveSession, SkillCommandSource } from '@robota-sdk/agent-framework';
   // ...
   const session = new InteractiveSession({
     // ...
     commandModules: [
       createBuiltinCommandModule(),
       {
         source: new SkillCommandSource({
           skills: [{ name: 'code-reviewer', content: `...SKILL.md content...` }],
         }),
       },
     ],
   });
   ```

5. 서버 Skills 카탈로그 API 업데이트:
   - `GET /api/playground/catalog/skills` 응답에 `skillMdContent` 필드 추가
   - 프론트엔드 카탈로그와 서버 카탈로그 동기화

## Non-Goals

- 사용자 커스텀 SKILL.md 업로드 (로컬 파일 시스템 접근)
- SKILL.md 문법 검증기
- skill 간 의존성 관리

## Architecture

```
packages/agent-playground/src/skills/
├── types.ts          ← IPlaygroundSkillMeta (skillMdContent 추가)
├── catalog.ts        ← SKILL.md 형식 스킬 2개
└── skill-md-parser.ts ← NEW: frontmatter 파싱 유틸

packages/agent-playground/src/components/playground/skills-panel/
└── skill-md-viewer.tsx  ← NEW: SKILL.md 뷰어 모달

packages/agent-playground/src/lib/code-generator/
└── assembly-serializer.ts  ← skill 코드 생성 업데이트

apps/agent-server/src/catalog/
└── skills.ts         ← skillMdContent 필드 포함으로 업데이트
```

## Test Plan

- 단위 테스트:
  - `skill-md-parser.ts`: frontmatter 파싱 검증
  - 코드 생성: skill 포함 시 `SkillCommandSource` 패턴 생성 확인
- `pnpm typecheck && pnpm test`

## User Execution Test Scenarios

### Scenario 1: SKILL.md 내용 확인

**Prerequisites**: 서버 실행

**Steps**:

1. Playground 접속 → Skills 탭 클릭
2. "Code Reviewer" 카드의 "View SKILL.md" 버튼 클릭

**Expected observable result**:

- SKILL.md frontmatter (name, description 등)와 skill 지시 내용이 모달에 표시됨

**Evidence**: `<스크린샷 — 구현 후 기입>`

### Scenario 2: Skill 포함 Code Export

**Prerequisites**: 에이전트 생성 + Code Reviewer skill 드래그 추가

**Steps**:

1. Code Export 탭 클릭

**Expected observable result**:

- 생성 코드에 `SkillCommandSource` 또는 skill 설정 코드 포함
- `systemPromptAddition` 단순 문자열 추가 방식이 아님

**Evidence**: `<스크린샷 — 구현 후 기입>`
