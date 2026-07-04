---
title: 'CORE-020: 실행 에러 구조화(error 필드) + bin.ts IME 휴리스틱 크래시 삼킴 제거'
status: todo
created: 2026-07-04
priority: high
urgency: now
area: packages/agent-core, packages/agent-cli
depends_on: []
---

# 실행 에러 구조화(error 필드) + bin.ts IME 휴리스틱 크래시 삼킴 제거

Re-audit P1-5 (RUNTIME-08 단서 반영 + RUNTIME-34). 실행 실패가 response:"Error:..." 문자열로
반환되고 error 필드 부재(success:false는 설정됨) — response 텍스트 소비 경로는 에러를 정상
응답으로 수신. bin.ts IME 휴리스틱은 'slice' 포함 일반 에러를 TUI 가드 검사 전에 삼킨다.

## What

1. 실패 결과 error 필드 신설 + response 에러 텍스트 주입 제거 — run()이 throw.
2. bin.ts IME 허용목록을 TUI 가드 활성 시로 한정(또는 스택 프레임 기반).

## Test Plan

- 실패 주입 시 run() throw + runStream 에러 전파; bin.ts 분기 테스트.

## User Execution Test Scenarios

- agent-executable. 라이브 headless(-p)로 실패 도구 실행 → 비정상 종료코드 + 에러 표면화 실측.
- Evidence: (record after execution)
