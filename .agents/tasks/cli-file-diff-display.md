---
title: CLI 파일 수정 시 diff 화면 노출
status: backlog
priority: medium
created: 2026-03-23
packages:
  - agent-cli
---

## 요약

AI가 파일을 수정할 때 변경 전/후 diff를 CLI 화면에 표시하는 기능.

## 리서치 필요

- Claude Code의 diff 표시 방식 (inline diff, side-by-side, unified)
- Ink 기반 diff 렌더링 (색상, +/- 라인)
- Edit tool 실행 결과에서 diff 정보 추출 방법
