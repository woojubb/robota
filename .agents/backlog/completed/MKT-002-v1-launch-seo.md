---
title: 'MKT-002: v1.0.0 선언 계획 수립 + SEO 기반 정비'
status: todo
created: 2026-05-18
priority: medium
urgency: soon
area: content/, apps/docs
depends_on: [WEB-001, MKT-001]
---

## Background

CEO 분석 결과: "beta" 라벨이 기업 채택 심리를 막는 가장 큰 장벽이다(beta.59는 기술적으로 안정적). SEO는 사실상 0인 상태 — "langchain typescript alternative", "claude code open source" 같은 검색어에 순위가 없다. 지금 시작하지 않으면 2026년 말 AI 도구 검색 경쟁이 치열해진 후 진입하게 된다.

분석 보고서: `.design/planning/agent-ceo.md`

## Scope

### 1. v1.0.0 선언 체크리스트 문서

`.design/planning/v1-launch-checklist.md` 작성:

- 기술 완성 기준: replay 기능, 핵심 시나리오 테스트 통과, 문서 3개 레이어 동기화
- 마케팅 준비: CHANGELOG.md, migration guide (beta → v1.0.0), 런치 블로그 포스트
- 커뮤니티 준비: GitHub Discussions, CONTRIBUTING.md, good first issues 10개 이상

### 2. SEO 기반 정비

`apps/docs/.vitepress/config/en.js` (또는 config.ts):

- `head` 메타 태그 추가:
  - `og:description` — 포지셔닝 메시지 기반
  - `og:image` — 소셜 공유 이미지
  - `twitter:card`, `twitter:description`
  - `keywords` meta

`apps/docs/public/sitemap.xml` 또는 VitePress sitemap 플러그인 활성화.

### 3. 타겟 키워드 블로그 포스트 계획

다음 키워드를 각각 심층 커버하는 블로그 포스트 주제를 `.design/planning/seo-content-plan.md`에 수립:

- "typescript ai agent sdk"
- "langchain alternative typescript"
- "claude code alternative open source"
- "build coding agent cli"
- "ai agent mcp server typescript"

### 4. 공개 로드맵 페이지

`content/roadmap.md` 작성 — `FUTURE-PROJECTS.md` 내용을 공개 가능한 형태로 요약:

- Phase 1: 현재 beta 안정화 / v1.0.0 선언
- Phase 2: Playground 퍼블릭 데모
- Phase 3: Robota Cloud (팀 플랜)

## Acceptance Criteria

- `.design/planning/v1-launch-checklist.md`가 존재하고 v1.0.0 기준이 명시된다.
- VitePress config에 `og:description`과 `twitter:card` 메타 태그가 추가된다.
- VitePress에 sitemap이 설정된다.
- `content/roadmap.md` 공개 로드맵 페이지가 작성된다.
- SEO 콘텐츠 계획 문서가 존재한다.

## Test Plan

- `pnpm docs:build` 후 빌드 결과물의 `index.html`에 og:description 태그 존재 확인
- `sitemap.xml`이 빌드 결과물에 생성되는지 확인
- 로드맵 페이지가 VitePress nav에 연결되는지 확인

## User Execution Test Scenarios

**Scenario 1: 메타 태그 확인**

Prerequisites: `pnpm docs:build` 완료

Steps:

1. `apps/docs/.vitepress/dist/index.html` 열기
2. `<meta property="og:description"` 태그 존재 확인
3. `<meta name="twitter:card"` 태그 존재 확인

Expected: 포지셔닝 메시지 기반 og:description이 HTML에 포함된다.

Evidence: (to be filled after implementation)

**Scenario 2: 공개 로드맵 페이지**

Prerequisites: `pnpm docs:dev` 실행 중

Steps:

1. `http://localhost:5173/roadmap` 접속
2. Phase 1~3 로드맵 내용 확인

Expected: 로드맵 페이지가 렌더링되고, v1.0.0 계획과 이후 단계가 명시된다.

Evidence: (to be filled after implementation)
