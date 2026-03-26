---
title: Fast Mode — 세션 내 모델 전환 (속도/비용 트레이드오프)
status: backlog
priority: medium
urgency: later
created: 2026-03-26
packages:
  - agent-sdk
  - agent-cli
---

## 요약

현재 모델 변경 시 세션 재시작 필요. 세션 내에서 빠른 모델과 강력한 모델을 토글할 수 있어야 함.

## 필요 기능

1. `/fast` 토글 — 같은 세션에서 모델 전환 (예: Opus ↔ Haiku)
2. Provider가 모델 전환 지원
3. InteractiveSession에서 모델 핫스왑
4. 상태바에 현재 모델 표시

## 참고

- Claude Code: `/fast` toggle, same model family with faster output
