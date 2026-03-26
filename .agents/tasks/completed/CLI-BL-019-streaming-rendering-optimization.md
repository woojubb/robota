---
title: Streaming Rendering Optimization — 마크다운 렌더링 부하 감소
status: backlog
priority: high
urgency: now
created: 2026-03-27
packages:
  - agent-cli
  - agent-sdk
---

## 요약

스트리밍 중 텍스트를 받을 때마다 마크다운 렌더링(테이블, 코드 블록 등)을 매번 재실행하여 CPU 부하가 심함. 긴 응답에서 특히 심각.

## 문제

- text_delta 이벤트가 토큰 단위로 발생 (초당 수십~수백 회)
- 매 delta마다 전체 streamingText를 마크다운 → 터미널 변환
- 응답이 길어질수록 변환 비용 증가 (O(n) × 이벤트 수)
- 테이블, 코드 블록 등 복잡한 마크다운은 변환 비용이 높음

## 해결 방향

- text_delta를 디바운스하여 모아서 스토어 업데이트
- 렌더링 빈도를 제한 (예: 60fps → 16ms 간격)
