---
title: 'WEB-002: 온보딩 결정 트리 + 로컬 모델 첫 번째 경로'
status: done
completed: 2026-05-18
created: 2026-05-18
priority: high
urgency: soon
area: content/getting-started
depends_on: [WEB-001]
---

## Background

3인 분석 결과: Getting Started가 5가지 예제를 순서 없이 나열해 신규 방문자가 어디서 시작할지 모른다. 또한 API 키 없이 체험할 수 있는 LM Studio 경로가 숨겨져 있어 진입 장벽이 높다.

분석 보고서: `.design/planning/comprehensive-report.md`

## Scope

`content/getting-started/README.md`:

1. **Use-Case Selector(결정 트리) 추가** — 파일 상단에 "Which path is right for you?" 섹션
   - "터미널 코딩 어시스턴트 즉시 사용" → CLI Quick Start
   - "앱/챗봇에 AI 내장" → First Agent (5 lines)
   - "프로바이더 교체 없이 코드 재작성" → Switch Providers
   - "SDK로 멀티턴 세션 구축" → InteractiveSession
   - "API 키 없이 무료 체험" → LM Studio 로컬 모델

2. **"No API key? Start here" 섹션 추가** — LM Studio 로컬 모델을 첫 번째 접근 가능한 경로로 강조
   - LM Studio 설치 → 모델 다운로드 → 로컬 서버 → `robota` 실행 흐름

3. **CLI를 "2분 경로"로 첫 번째 배치** — `npm install -g @robota-sdk/agent-cli && robota` 원라이너 강조

## Acceptance Criteria

- Getting Started 상단에 "Which path is right for you?" 결정 트리가 있다.
- 각 경로가 해당 섹션 앵커로 연결된다.
- "No API key?" 섹션이 추가되어 LM Studio 경로를 명시한다.
- CLI 원라이너(`npm install -g @robota-sdk/agent-cli && robota`)가 첫 번째 섹션에 있다.

## Test Plan

- `pnpm docs:build` — VitePress 빌드 성공 확인
- 앵커 링크(`#quick-start--cli` 등)가 올바르게 동작하는지 확인
- 결정 트리의 각 링크가 해당 섹션으로 점프하는지 확인

## User Execution Test Scenarios

**Scenario 1: 신규 방문자 결정 트리**

Prerequisites: `pnpm docs:dev` 실행 중

Steps:

1. `http://localhost:5173/getting-started/` 접속
2. 첫 화면에서 "Which path is right for you?" 섹션 확인
3. "I have no API key" 링크 클릭 → LM Studio 섹션으로 이동 확인
4. "I want a coding assistant now" 링크 클릭 → CLI 섹션으로 이동 확인

Expected: 5가지 경로 선택지가 있고 각 링크가 해당 섹션으로 이동한다.

Evidence: (to be filled after implementation)
