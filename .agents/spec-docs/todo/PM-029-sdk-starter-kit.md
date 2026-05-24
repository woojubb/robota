---
status: approved
type: SCREEN
tags: [sdk, docs, onboarding]
---

# PM-029: SDK Starter Kit — Next.js + Express 템플릿 저장소

## Problem

`npm install @robota-sdk/core` 이후 단계가 없다. SDK를 어떻게 시작하는지 예제 프로젝트가 없어 개발자가 "SDK로 AI 앱을 만들 수 있다"는 것을 경험할 수 없다.

재현 조건: `@robota-sdk/core` 설치 후 Next.js AI 채팅 앱 구현 시도 → 예제 프로젝트 없음, 진행 불가.

## Architecture Review

### Affected Scope

- `apps/starter-nextjs/` — Next.js AI Chat 템플릿 신규 추가
- `apps/docs/content/quickstart.mdx` — 5분 퀵스타트 가이드

### Alternatives Considered

- **Alt A (채택): Next.js + Express 두 템플릿 + npx create-robota-app** — Pro: 웹/서버 두 주요 use case 커버. Con: 두 템플릿 유지보수 필요.
- **Alt B: StackBlitz 인터랙티브 예제만 제공** — Pro: 별도 저장소 불필요. Con: 로컬 개발 가이드 없음, StackBlitz 의존성.

### Decision

Alt A 채택. Next.js 템플릿(웹 AI 채팅)과 Express 템플릿(백엔드 에이전트)을 각각 `apps/` 에 추가. Vercel "Deploy to Vercel" 버튼으로 즉시 배포 가능.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — apps/ 디렉토리 구조 및 기존 예제 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`apps/starter-nextjs/`에 Next.js AI Chat 앱 템플릿 추가. `@robota-sdk/core` + provider 사용. README에 5분 설정 가이드 포함. docs에 `quickstart.mdx` 추가.

## Affected Files

- `apps/starter-nextjs/package.json`
- `apps/starter-nextjs/app/api/chat/route.ts`
- `apps/docs/content/quickstart.mdx`

## Completion Criteria

- [ ] TC-01: README 지시대로 clone + 환경변수 설정 → 5분 내 AI 채팅 앱 실행
- [ ] TC-02: `ANTHROPIC_API_KEY`만 설정하면 에러 없이 실행됨
- [ ] TC-03: Vercel 무료 배포 가능 (환경변수 1개만 필요)
- [ ] TC-04: docs 퀵스타트 페이지가 로드됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                   | Notes                                                                   |
| ----- | --------- | --------------------------------- | ----------------------------------------------------------------------- |
| TC-01 | manual    | clone + run walkthrough           | Follow README step by step — requires human to verify 5-min setup claim |
| TC-02 | unit      | pnpm build && pnpm dev            | Build succeeds with only API key env var set                            |
| TC-03 | manual    | Vercel deploy button test         | Click deploy button — requires Vercel account, cannot be automated      |
| TC-04 | e2e       | playwright — docs page load check | Navigate to /docs/quickstart, verify page renders                       |

## Tasks

- [ ] `.agents/tasks/PM-029.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: SCREEN` is a valid 11-prefix type; `tags: [sdk, docs, onboarding]` present.
- Problem section: concrete symptom present ("npm install 이후 단계 없음, 예제 없음"); reproduction condition present ("@robota-sdk/core 설치 후 Next.js 앱 구현 시도 → 불가"); no TBD/TODO/vague single-sentence description found.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with evidence ("apps/ 디렉토리 구조 및 기존 예제 확인"); 2 alternatives (Alt A, Alt B) each with Pro/Con; decision references trade-off (유지보수 부담 vs 두 use case 커버).
- Completion Criteria: 4 items (TC-01 ~ TC-04), all have TC-N prefix; each uses observable behavior form; no forbidden vague language ("works correctly", "no errors", "implemented", "displays correctly") found.
- Test Plan: `## Test Plan` section present; 4 rows matching TC-01 ~ TC-04 (count matches Completion Criteria); all rows have non-empty Test Type and Tool/Approach; manual rows TC-01 and TC-03 each have non-empty Notes explaining why automation is not possible.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and was empty before this entry; no `## Status` or `## Classification` sections in body.
- TC-N count: Completion Criteria = 4, Test Plan rows = 4 — counts match.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: PM group (PM-023~037)
