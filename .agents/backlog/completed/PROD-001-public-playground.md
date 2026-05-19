---
title: 'PROD-001: 퍼블릭 플레이그라운드 — API 키 입력 즉시 체험 데모'
status: done
completed: 2026-05-18
created: 2026-05-18
priority: high
urgency: later
area: apps/agent-web, apps/agent-server
depends_on: [WEB-001, WEB-004]
---

## Background

CEO·기획자·디자이너 3인 공통 발견: 가장 강력한 "체험" 경로가 사용자 여정에서 완전히 단절되어 있다. 현재 `apps/agent-web/playground`는 WebSocket URL을 직접 주입해야 하는 개발자 전용 도구이며, robota.io에서 진입할 방법이 없다. PLG(Product-Led Growth) funnel의 핵심 진입점이 없는 상태.

벤치마크: Vercel "Deploy in seconds" (마찰 제거), Vercel AI SDK playground (API 키 → 즉시 체험)

분석 보고서: `.design/planning/comprehensive-report.md`

## Scope

### Phase 1: API 키 입력 플레이그라운드

`apps/agent-web/playground` 페이지를 퍼블릭 체험 가능한 형태로 전환:

1. **Provider + API Key 입력 UI** — 첫 방문 시 Provider 선택 드롭다운 + API 키 입력 필드
   - API 키는 브라우저 localStorage에만 저장, 서버로 전송하지 않음
   - 지원: Anthropic, OpenAI, Gemini, DeepSeek

2. **BYOK (Bring Your Own Key) 연결 플로우** — API 키를 agent-server로 전달, 서버에서 해당 프로바이더로 요청
   - 서버: API 키를 세션 메모리에만 보관, 저장 금지
   - HTTPS 필수 (평문 전송 차단)

3. **Starter prompt 제안** — 첫 연결 시 3개 예제 프롬프트 버튼 표시

4. **robota.io 통합** — VitePress Hero CTA에 "Try Playground" 버튼 → `play.robota.io` 또는 `/playground`

### Phase 2 (후속): 호스팅 데모 엔드포인트

Rate-limited 공용 API 키로 운영하는 데모 모드 (API 키 없이도 체험 가능). 별도 백로그로 추적.

## Acceptance Criteria

- `robota.io` 또는 `play.robota.io`에서 API 키 입력 → Robota CLI 브라우저 체험이 가능하다.
- API 키가 서버 로그나 DB에 저장되지 않는다.
- WS 연결 실패 / API 키 오류 시 명확한 에러 메시지가 표시된다 (WEB-004 완료 후).
- robota.io 홈 Hero CTA에서 플레이그라운드로 연결된다.

## Test Plan

- `apps/agent-web` E2E 테스트: API 키 입력 → WS 연결 → 프롬프트 전송 → 응답 수신 플로우
- 보안 검증: 네트워크 탭에서 API 키가 WS 메시지 이외 경로로 전송되지 않는지 확인
- 에러 케이스: 잘못된 API 키 입력 시 에러 메시지 표시 확인
- `pnpm --filter robota-web build` — 빌드 성공 확인

## User Execution Test Scenarios

**Scenario 1: API 키 입력 후 플레이그라운드 사용**

Prerequisites: `apps/agent-web` + `apps/agent-server` 로컬 실행 중, 유효한 Anthropic API 키 보유

Steps:

1. `http://localhost:3000/playground` 접속
2. Provider "Anthropic" 선택, API 키 입력 후 "Connect" 클릭
3. Starter prompt 중 하나 클릭 또는 직접 입력
4. AI 응답이 스트리밍으로 표시되는지 확인

Expected: API 키 입력 → WS 연결 → 프롬프트 전송 → AI 응답이 브라우저에서 작동한다.

Evidence: (to be filled after implementation)

**Scenario 2: robota.io에서 플레이그라운드 진입**

Prerequisites: `pnpm docs:dev` 실행 중

Steps:

1. `http://localhost:5173` 접속
2. Hero CTA "Try Playground" 버튼 클릭
3. 플레이그라운드 페이지로 이동 확인

Expected: 홈 페이지 CTA에서 플레이그라운드로 이동할 수 있다.

Evidence: (to be filled after implementation)
