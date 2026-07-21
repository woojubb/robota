---
title: 'ARCH-004: 선행 제공 표면 하드닝: transport-http/-mcp·agent-plugin·가격표·stateless-runtime 1급 정비'
status: done
completed: 2026-07-21
created: 2026-07-04
priority: high
urgency: soon
area: packages/agent-transport-http, packages/agent-transport-mcp, packages/agent-plugin, packages/agent-core, packages/agent-framework
depends_on: ['HARNESS-022']
---

# 선행 제공 표면 하드닝: transport-http/-mcp·agent-plugin·가격표·stateless-runtime 1급 정비

Re-audit P2-10, 원칙 재편(2026-07-04): 이 표면들은 죽은 코드가 아니라 외부 소비자를 위한 선행
제공물이다(§ Forward-Provisioned Surface Rule). 처분(삭제 vs 배선) 대신 유지 + 1급 품질 정비.
그 위의 런타임 결함은 무조건 수정으로 승격.

## What

1. RUNTIME-13: WS transport stop() 영구 행(클라이언트 종료 + 기한 후 terminate).
2. RUNTIME-14: HTTP /submit 리스너 try/finally + onAbort + writeSSE await/catch.
3. RUNTIME-38(재상정): HTTP 동시 스트림 크로스톡 실증 후 턴 상관 또는 동시 submit 거부.
4. RUNTIME-54: Playground WS 인증 대기 타임아웃.
5. 표면별 SPEC/README 정확화 + 누락 테스트 보강; 소비 진입점 문서화(배선 여부는 별도 제품
   결정으로 열어둠).
6. STRUCT-07(framework ./testing pass-through)은 소유권 규칙 위반이라 제거.

## Test Plan

- 각 결함 회귀 테스트; transport-http/-mcp 기능 테스트 신설.

## User Execution Test Scenarios

- agent-executable. transport-http 라이브 기동 → /submit 스트림 왕복 + 클라이언트 강제 절단 후
  서버 정상(리스너 잔존 0) 실측; WS stop()이 연결 활성 상태에서 기한 내 완료 실측.
- Evidence: (record after execution)
