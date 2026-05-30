---
title: 'WEB-003: 브랜드 컬러 통합 + 코드 탭 전환 + 사이드바 계층화'
status: done
completed: 2026-05-18
created: 2026-05-18
priority: high
urgency: soon
area: apps/docs, apps/blog, content/
depends_on: [WEB-001]
---

## Background

웹 디자이너 분석 결과: 문서(파란색 #3a70ff), Playground(바이올렛 #a78bfa), 블로그(그린)가 서로 다른 브랜드 컬러를 사용해 단일 SDK임에도 세 얼굴로 보인다. 또한 코드 예제가 탭 전환 없이 프로바이더별로 순차 나열되어 있고, 사이드바가 자동 생성되어 수동 정보 계층이 없다.

분석 보고서: `.design/planning/agent-web-designer.md`

## Scope

### 1. 브랜드 컬러 통합

통일 팔레트: Violet `#7C6BF7` (light) / `#A78BFA` (dark)

- `apps/docs/.vitepress/theme/style.css`:
  - `--vp-c-brand-1: #7C6BF7`
  - `--vp-c-brand-2: #6355E8`
  - `--vp-c-brand-3: #9380FA`
  - `.dark` 토큰 별도 정의 (`--vp-c-brand-1: #A78BFA`)
- `apps/blog/src/styles/global.css` (또는 해당 CSS 파일):
  - `--green` → `--brand: #7C6BF7`으로 교체

### 2. 모바일 코드 블록 CSS

`apps/docs/.vitepress/theme/style.css`에 추가:

```css
@media (max-width: 768px) {
  .vp-doc div[class*='language-'] pre {
    font-size: 12px;
    padding: 12px;
  }
}
```

### 3. 코드 탭 전환 컴포넌트

VitePress `:::code-group` 내장 문법을 활용해 Quick Start 섹션의 프로바이더별 코드 예제를 탭 방식으로 재구성.

- `content/getting-started/README.md` 또는 `content/examples/` 에서 Anthropic/OpenAI/Gemini 코드 예제를 `:::code-group`으로 감싸기

### 4. 사이드바 수동 계층화

`apps/docs/.vitepress/config/en.js` 또는 `config.ts`에 sidebar 수동 구성 추가:

```
Getting Started: Installation → Quick Start → First Agent
Guide / Concepts: Architecture, Providers
Guide / Building: Tools, Sessions, Subagents
Guide / Advanced: Plugins, Streaming, CLI
API Reference: agent-core, agent-framework, agent-provider
```

## Acceptance Criteria

- 문서/블로그의 포인트 컬러가 Violet 계열로 통일된다.
- 다크모드에서 브랜드 컬러 contrast가 적절하다.
- Getting Started 코드 예제에 프로바이더 탭 전환이 적용된 섹션이 하나 이상 있다.
- 사이드바가 "Getting Started / Guide / API Reference" 그룹으로 계층화된다.
- 모바일(320px 기준)에서 코드 블록이 가로 스크롤 없이 읽힌다.

## Test Plan

- `pnpm docs:build` — VitePress 빌드 성공 확인
- `pnpm --filter robota-blog build` — 블로그 빌드 성공 확인
- 로컬 docs:dev에서 다크/라이트 모드 전환 시 브랜드 컬러 확인
- 코드 탭이 클릭 시 전환되는지 확인
- 사이드바 그룹핑이 의도한 계층 구조로 나타나는지 확인

## User Execution Test Scenarios

**Scenario 1: 브랜드 컬러 통일 확인**

Prerequisites: `pnpm docs:dev` 실행 중

Steps:

1. `http://localhost:5173` 접속 — 브랜드 컬러가 바이올렛 계열인지 확인
2. 다크모드 토글 — dark 모드에서도 바이올렛 계열 컬러 확인
3. 블로그 로컬 실행 후 포인트 컬러가 동일한 바이올렛인지 확인

Expected: 문서와 블로그 모두 Violet #7C6BF7 / #A78BFA 계열 포인트 컬러를 사용한다.

Evidence: (to be filled after implementation)

**Scenario 2: 코드 탭 전환**

Steps:

1. Getting Started 또는 예제 페이지 접속
2. 프로바이더 탭(Anthropic / OpenAI / Gemini)이 있는 코드 블록 확인
3. 탭 클릭 시 코드가 전환되는지 확인

Expected: 탭 클릭 시 해당 프로바이더의 코드로 전환된다.

Evidence: (to be filled after implementation)
