---
title: 'PM-030: opt-in 익명 텔레메트리 — 실제 사용 패턴 수집'
status: superseded
completed: 2026-07-25
created: 2026-05-24
priority: low
urgency: later
area: packages/agent-cli, packages/agent-framework
depends_on: []
---

> **Superseded by AUDIT-001 (done).** A telemetry stub shipped in PR #589
> (`packages/agent-cli/src/startup/telemetry.ts` + first-run opt-in prompt) but had no collection
> backend and was deliberately removed in full by AUDIT-001 decision B ("Remove telemetry
> entirely", commit 9c53c19d3, 2026-05-25). No telemetry code exists today; re-introducing it
> would need a fresh spec. Reconciled 2026-07-25 (PROC-001).

## Background

현재 Robota CLI가 실제로 어떻게 사용되는지 알 방법이 없다. "가장 많이 쓰는 명령어", "평균 세션 길이", "가장 자주 실패하는 도구" 같은 데이터가 있으면 무엇을 먼저 개선해야 할지 판단할 수 있다.

opt-in 텔레메트리는 투명하게 사용자에게 선택권을 주면서 제품 개선에 필요한 데이터를 수집하는 표준적 방법이다. Next.js, Gatsby, Turbo, pnpm 모두 이 방식을 사용한다.

## 작업 항목

### 첫 실행 동의 프롬프트

```
Robota 개선을 위해 익명 사용 데이터를 수집해도 될까요?
수집 항목: 세션 길이, 실행된 명령어 수, 오류 유형
미수집 항목: 파일 내용, API 키, 대화 내용, 개인정보

[Y] 동의  [N] 거절  [?] 상세 보기
```

### 수집 이벤트 (opt-in 시만)

```typescript
type TelemetryEvent =
  | { type: 'session_start'; version: string; os: string; node_version: string }
  | { type: 'session_end'; duration_seconds: number; turns: number }
  | { type: 'tool_call'; tool_name: string; success: boolean }
  | { type: 'error'; error_code: string } // 메시지 내용 없이 코드만
  | { type: 'command_used'; command: string }; // /help, /cost 등
```

### 구현 규칙

- 동의 여부: `~/.robota/settings.json`의 `telemetry: true/false`에 저장
- 거절이 default (opt-in, opt-out이 아님)
- 언제든 `robota config set telemetry false`로 끌 수 있음
- 개인식별정보(PII) 절대 수집 금지 (내용, 경로, 사용자명 등)
- 수집 서버: 자체 운영 또는 Plausible/PostHog (self-hosted)
- 소스 코드에 수집 항목 전체 공개

### 사용자 투명성

- `robota --telemetry-status` → 수집 여부 + 수집되는 데이터 전체 목록 표시
- docs에 "텔레메트리 정책" 페이지

## 성공 기준

- opt-in rate 측정 (목표: 30% 이상이 동의)
- 수집된 데이터로 "가장 많이 쓰는 기능 Top 5" 파악 가능
- 사용자 불만 없음 (개인정보 수집 의혹 이슈 없음)
