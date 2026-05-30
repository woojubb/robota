---
title: 'WEB-001: 랜딩 포지셔닝 + 신뢰 신호 + Claude Code 호환 Quick Wins'
status: done
completed: 2026-05-18
created: 2026-05-18
priority: high
urgency: now
area: content/, apps/docs
depends_on: []
---

## Background

3인 병렬 분석(기획자·CEO·디자이너) 결과 공통 발견: 랜딩 페이지가 포지셔닝이 아닌 기능 목록이며, 신뢰 신호가 전무하다. Phase 1 빠른 Win — 코드 변경 없이 content/ 편집만으로 전환율에 즉시 영향을 미치는 항목들.

분석 보고서: `.design/planning/comprehensive-report.md`

## Scope

`content/README.md` (홈 페이지):

1. **Hero 포지셔닝 문장 교체** — 기능 나열 → 한 줄 가치 제안으로
2. **npm/GitHub 신뢰 신호 배지 추가** — npm version, downloads, GitHub stars, License, TypeScript
3. **경쟁 포지셔닝 테이블 추가** — Robota vs Claude Code / LangChain / OpenAI SDK 비교
4. **Claude Code 호환성 셀링포인트 섹션** — `.claude/` 경로 호환을 drop-in migration 포인트로 강조
5. **패키지 설치 가이드 재구성** — 9개 패키지 나열 → 목적별(CLI / 커스텀 에이전트 / 세션 앱) 그룹

`content/getting-started/README.md`:

6. **macOS Terminal 경고 이동** — 온보딩 첫 화면에서 Troubleshooting 섹션으로 이동

`apps/docs/.vitepress/` (VitePress config):

7. **nav에 Playground 링크 추가** — 외부 링크로 play.robota.io 또는 현재 배포 URL

## Acceptance Criteria

- `content/README.md` 첫 문장이 포지셔닝 메시지(가치 제안)로 교체된다.
- README 상단에 shields.io 배지 5개 이상이 표시된다.
- "Robota vs Alternatives" 비교 테이블이 포함된다.
- "Claude Code Users: Drop-in Compatible" 섹션이 포함된다.
- 설치 가이드가 목적별 3개 그룹(CLI / Custom Agent / App with Sessions)으로 재구성된다.
- macOS 경고가 Getting Started 첫 설치 단계에서 제거된다.
- VitePress nav에 Playground 링크가 포함된다.

## Test Plan

- `pnpm docs:build` — VitePress 빌드 성공 확인
- 로컬 `pnpm docs:dev` 실행 후 홈 페이지 렌더링 확인
- 배지 URL이 유효한 shields.io 형식인지 확인 (markdown 링크 문법 검증)
- nav Playground 링크가 올바른 URL로 설정됐는지 확인

## User Execution Test Scenarios

**Scenario 1: 홈 페이지 첫인상**

Prerequisites: `pnpm docs:dev` 실행 중

Steps:

1. 브라우저에서 `http://localhost:5173` 접속
2. 첫 화면에서 포지셔닝 문장 확인
3. 배지 줄 확인
4. "Robota vs Alternatives" 섹션 확인
5. "Claude Code Users" 섹션 확인
6. nav에 Playground 링크 확인

Expected: 3초 안에 "왜 Robota인가"가 전달되는 메시지, 배지, 비교 테이블이 보인다.

Evidence: (to be filled after implementation)

**Scenario 2: Getting Started macOS 경고 위치**

Steps:

1. `http://localhost:5173/getting-started/` 접속
2. 설치 명령어 첫 단계 확인 — macOS 경고가 없어야 함
3. Troubleshooting 섹션 또는 FAQ에 경고가 이동됐는지 확인

Expected: 설치 명령어 바로 아래에 macOS 경고가 없다.

Evidence: (to be filled after implementation)
