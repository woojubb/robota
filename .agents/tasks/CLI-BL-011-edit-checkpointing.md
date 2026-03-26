---
title: Edit Checkpointing — 파일 편집 전 스냅샷 + 되돌리기
status: backlog
priority: high
created: 2026-03-26
packages:
  - agent-sdk
  - agent-cli
---

## 요약

파일 편집 시 스냅샷이 없어서 잘못된 편집을 되돌릴 수 없음. git reset만으로는 부족 (커밋 전 변경 손실 위험).

## 필요 기능

1. Edit/Write 도구 실행 전 원본 파일 자동 스냅샷
2. 세션별 체크포인트 디렉토리에 저장
3. Esc Esc — 마지막 편집 되돌리기 (rewind)
4. 선택적 되돌리기 — 특정 파일만 복원
5. 세션 종료 시 체크포인트 정리

## 참고

- Claude Code: automatic checkpoints, Esc Esc rewind
- git과 보완적 관계 (커밋 전 안전망)
