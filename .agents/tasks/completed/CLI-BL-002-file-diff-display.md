---
title: CLI-BL-002 파일 수정 시 diff 화면 노출
status: backlog
priority: medium
created: 2026-03-23
packages:
  - agent-cli
---

## 요약

AI가 파일을 수정(Edit tool)할 때 변경 전/후 diff를 CLI 화면에 표시하는 기능.

## 스펙

`packages/agent-cli/docs/SPEC.md`의 "Edit Diff Display" 섹션에 정의됨.

- old_string/new_string에서 diff 생성
- 빨강(삭제)/초록(추가) 색상
- 파일명 헤더
- 최대 10줄 표시, 초과 시 말줄임
- 실시간 표시 + 실행 후 요약 모두 적용
- 향후: permission prompt에도 diff 표시

## 구현 방향

1. `onToolExecution` 이벤트에서 Edit tool의 `old_string`/`new_string` 추출
2. 줄 단위 diff 생성 (삭제/추가 분류)
3. StreamingIndicator와 MessageList에서 diff 렌더링
4. 10줄 초과 시 truncation
