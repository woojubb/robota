---
title: CLI 실행 중 추가 프롬프트 입력 및 큐잉
status: backlog
priority: high
created: 2026-03-24
packages:
  - agent-cli
  - agent-sessions
---

## 요약

AI가 작업 중일 때도 사용자가 추가 프롬프트를 입력할 수 있게 하고, 현재 작업이 완료되면 큐에 쌓인 추가 명령이 자동으로 실행되는 기능.

## 현재 상태

- InputArea는 `isDisabled={isThinking}` 으로 작업 중 입력 차단됨
- 사용자가 작업 중에 추가 지시를 입력할 수 없음

## 기능 요구사항

- 작업 중에도 InputArea에 텍스트 입력 가능
- 입력한 프롬프트는 큐에 저장
- 현재 실행이 끝나면 큐의 다음 프롬프트가 자동 실행
- 큐에 프롬프트가 있음을 시각적으로 표시 (예: "1 queued")
- 큐의 프롬프트는 assistant의 이전 응답 다음에 user message로 삽입

## 리서치 필요

- Claude Code가 이 기능을 어떻게 구현하는지
- 큐잉 vs 인터럽트 방식 비교
- conversation history에 큐된 메시지 삽입 타이밍
- abort와의 상호작용 (abort 후 큐 처리)
