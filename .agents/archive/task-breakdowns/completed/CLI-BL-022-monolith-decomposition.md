---
title: agent-cli monolith decomposition
status: completed
priority: high
urgency: soon
created: 2026-03-27
packages:
  - agent-cli
---

## 요약

agent-cli에 300줄 초과 프로덕션 파일 5개가 code-quality 규칙(anti-monolith)을 위반하고 있음. 각 파일의 책임을 분리하여 300줄 이하로 분해.

## 위반 파일 분석

### 1. `slash-executor.ts` (372줄) — 우선순위 높음

- 모든 빌트인 슬래시 명령(/model, /compact, /resume, /rename 등)의 실행 로직이 하나의 `executeSlashCommand()` switch에 집중
- 분리 방안: 각 명령을 독립 핸들러 함수/파일로 분리, executor는 라우팅만 담당

### 2. `App.tsx` (350줄) — 우선순위 높음

- 세션 생명주기 관리 + 플러그인 콜백 + 렌더링 + 이벤트 핸들링이 한 파일에
- 분리 방안: 세션 관리 로직을 커스텀 훅으로, 렌더링만 컴포넌트에 남김

### 3. `useInteractiveSession.ts` (346줄) — 우선순위 중간

- 이벤트 구독(text_delta, tool_start, tool_end 등) + 상태 관리 + 세션 생명주기
- 분리 방안: 이벤트 구독을 별도 훅으로, 상태 관리와 생명주기 분리

### 4. `InputArea.tsx` (327줄) — 우선순위 낮음

- useAutocomplete 훅 + parseSlashInput + 메인 컴포넌트 + 페이스트 핸들링
- 분리 방안: useAutocomplete를 별도 파일로 추출 (이미 함수 경계가 명확)

### 5. `PluginTUI.tsx` (308줄) — 우선순위 낮음

- 설치/검색/관리 모든 화면이 하나의 컴포넌트에
- 분리 방안: 각 화면(install, search, manage)을 별도 컴포넌트로

## 테스트 계획

- 각 파일 분해 전 기존 테스트가 통과하는지 확인
- 분해 후 동일 테스트가 그대로 통과해야 함 (행동 변경 없음)
- `pnpm --filter @robota-sdk/agent-cli test` 전체 통과 필수
- 분해 후 300줄 초과 파일 0개 확인: `find packages/agent-cli/src \( -name '*.ts' -o -name '*.tsx' \) -not -path '*__tests__*' | xargs wc -l | sort -rn | awk '$1 > 300'`

## 참고

- code-quality.md anti-monolith 규칙
- pre-refactor-test-harness 스킬: 분해 전 characterization test 작성 필수
