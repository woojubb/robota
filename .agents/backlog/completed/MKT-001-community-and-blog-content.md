---
title: 'MKT-001: GitHub 커뮤니티 개설 + 블로그 런치 콘텐츠 3편'
status: todo
created: 2026-05-18
priority: high
urgency: soon
area: apps/blog, .github/
depends_on: [WEB-001]
---

## Background

CEO·기획자 분석 결과: 개발자 신뢰 구축의 핵심 채널인 커뮤니티와 블로그 콘텐츠가 없다. GitHub Discussions·CONTRIBUTING.md 부재, 블로그 포스트 1개뿐. 모든 성공한 개발자 도구는 초기 커뮤니티 씨앗이 있었다(Supabase: HN Show HN, Linear: 디자이너 커뮤니티).

분석 보고서: `.design/planning/comprehensive-report.md`

## Scope

### 1. GitHub 커뮤니티 인프라

- `.github/CONTRIBUTING.md` — 최소 컨트리뷰터 가이드 작성
  - 개발 환경 세팅 (pnpm install, build, test)
  - PR 체크리스트 (typecheck, lint, test 통과)
  - good first issue 라벨 안내
- `.github/ISSUE_TEMPLATE/bug_report.md` — 버그 리포트 템플릿
- `.github/ISSUE_TEMPLATE/feature_request.md` — 기능 요청 템플릿

(GitHub Discussions 개설은 GitHub UI에서 수행 — repository Settings → Features → Discussions 활성화)

### 2. 블로그 런치 콘텐츠 3편

각 포스트는 `apps/blog/src/content/` 디렉터리에 마크다운으로 작성.

**포스트 1: "Build your own Claude Code in 50 lines of TypeScript"**

- 타겟: Hacker News, Reddit r/typescript
- 내용: `@robota-sdk/agent-cli` 설치 + CLI 실행부터 커스텀 에이전트 빌드까지
- 결론: Claude Code와 동일한 경험, 어떤 AI 프로바이더도 사용 가능

**포스트 2: "Multi-provider AI: how we cut costs 90% without changing agent logic"**

- 타겟: 실무 개발자, r/MachineLearning
- 내용: Anthropic → DeepSeek 전환 예제, provider 인터페이스 교체만으로 가능한 이유
- 결론: 벤더 락인 없는 설계의 실질적 가치

**포스트 3: "Why we built a strict TypeScript AI agent SDK (and banned `any`)"**

- 타겟: 시니어 엔지니어, TypeScript 커뮤니티
- 내용: Zod 기반 툴 스키마, strict 타입 시스템, plugin DI 아키텍처 결정
- 결론: 프로덕션 코드베이스에서 AI 에이전트 도입 시 타입 안전성의 중요성

## Acceptance Criteria

- `.github/CONTRIBUTING.md`가 존재하고 pnpm 기반 개발 환경 세팅 절차를 포함한다.
- 이슈 템플릿 2개(bug report, feature request)가 `.github/ISSUE_TEMPLATE/`에 존재한다.
- 블로그 포스트 3편이 `apps/blog/src/content/`에 마크다운으로 작성된다.
- 각 블로그 포스트가 `pnpm --filter robota-blog build` 후 빌드된다.

## Test Plan

- `pnpm --filter robota-blog build` — 3개 신규 포스트 포함 블로그 빌드 성공 확인
- 이슈 템플릿이 `.github/ISSUE_TEMPLATE/` 디렉터리에 올바른 YAML frontmatter로 존재하는지 확인
- CONTRIBUTING.md의 `pnpm install && pnpm build && pnpm test` 명령어가 실제 동작하는지 확인

## User Execution Test Scenarios

**Scenario 1: 블로그 포스트 렌더링**

Prerequisites: `pnpm --filter robota-blog dev` 실행 중

Steps:

1. 블로그 로컬 URL 접속
2. 3개 신규 포스트가 목록에 표시되는지 확인
3. 각 포스트 클릭 → 본문이 올바르게 렌더링되는지 확인

Expected: 3개 포스트가 목록에 표시되고, 본문에 코드 블록과 마크다운이 올바르게 렌더링된다.

Evidence: (to be filled after implementation)

**Scenario 2: GitHub 이슈 템플릿**

Not applicable — GitHub UI 기능. `.github/ISSUE_TEMPLATE/` 파일 존재 여부와 YAML 문법 유효성으로 Test Plan에서 검증.
