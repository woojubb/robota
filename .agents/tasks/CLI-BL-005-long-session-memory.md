---
title: CLI-BL-005 장시간 세션 메모리 최적화
status: backlog
priority: medium
created: 2026-03-23
packages:
  - agent-cli
---

## 문제

CLI를 장시간 (10시간+) 실행하면 Terminal.app이 크래시 (memory corruption of free block). iTerm2에서는 발생하지 않지만 메모리 누적이 근본 원인일 수 있음.

## 의심 원인

- `activeTools` 배열이 매 tool 실행마다 커지고 응답 완료 시에만 clear
- `messages` 배열이 대화 히스토리를 무한 누적
- Ink가 매 state 변경마다 전체 화면 re-render → 대량 ANSI escape 출력
- Node.js → Terminal 간 출력 버퍼 누적

## 개선 방향

- activeTools: 완료된 tool은 일정 개수 이상이면 오래된 것부터 제거
- messages: 화면에 보이는 최근 N개만 유지, 나머지는 session history에만 보존
- Ink re-render 최소화: 불필요한 state 변경 억제
- 장시간 세션 시 주기적 메모리 사용량 체크
