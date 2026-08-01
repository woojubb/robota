---
title: 'CLI-034: 공식 플러그인 1개 npm 게시 — ecosystem kickstart'
status: todo
created: 2026-05-24
priority: low
urgency: later
area: packages/
depends_on: []
---

## Progress (PROC-001 reconciliation, 2026-07-25)

Reopened: **nothing was implemented.** PR #589's task file claimed `@robota-sdk/plugin-file-system`
was published, but no `packages/plugin-*` package exists in the workspace and #589's diff created
none. Remaining: the entire item — and it should be re-scoped against the current plugin
architecture (`agent-plugin`, bundle plugin loader, marketplace source) before any work. Related
items PM-005/CLI-020 carry terminal statuses with the same unverified-claims smell; check them
before trusting their evidence.

## Background

Robota SDK가 "플러그인 기반 확장"을 핵심 아키텍처로 내세우지만 현재 공식 npm 플러그인이 없다. 생태계를 만들려면 공식 팀이 먼저 "이렇게 만드는 거야"를 보여주는 레퍼런스 플러그인이 필요하다.

플러그인이 없으면:

- 외부 개발자가 플러그인 개발 방법을 모름
- "플러그인 아키텍처"가 마케팅 문구로만 보임
- SDK 사용 사례가 제한됨

## 후보 플러그인

다음 중 구현 비용 대비 임팩트가 가장 큰 것 선택:

### Option A: `@robota-sdk/plugin-file-system`

- 파일 읽기/쓰기/목록 조회 도구 모음
- 가장 범용적, 구현 단순
- 이미 내부에 유사 코드가 있을 가능성 높음

### Option B: `@robota-sdk/plugin-web-search`

- Tavily 또는 Brave Search API 연동
- AI 코딩 어시스턴트에서 "최신 정보 검색" 수요 높음
- 외부 API 키 필요 → 설정 복잡성 있음

### Option C: `@robota-sdk/plugin-code-execution`

- Node.js 코드 샌드박스 실행 (vm2 또는 isolated-vm)
- SDK 데모에서 강력한 임팩트
- 보안 설계 복잡

## 작업 항목

1. 위 3개 후보 중 하나 선택 (설계 컨펌 필요)
2. 패키지 생성: `packages/plugin-<name>/`
3. SPEC.md 작성 후 구현
4. README.md에 설치 및 사용 예제
5. `pnpm publish:beta`로 npm 게시
6. robota.io docs에 플러그인 개발 가이드 추가

## 성공 기준

- `npm install @robota-sdk/plugin-<name>` 가능
- README 예제 코드가 실제로 동작
- docs에 플러그인 개발 가이드 게시
- CHANGELOG에 첫 번째 공식 플러그인으로 기록
