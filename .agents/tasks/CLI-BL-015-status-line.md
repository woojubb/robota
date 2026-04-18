---
title: Status Line — 실시간 상태 표시줄
status: backlog
priority: medium
urgency: soon
created: 2026-03-26
packages:
  - agent-cli
---

## 요약

터미널 하단에 실시간 정보 표시 (context usage, git branch, 모델명 등). 현재 StatusBar 컴포넌트가 있으나 기능 미흡.

## 필요 기능

1. Context window 사용량 (% + 토큰 수) 실시간 표시
2. 현재 git 브랜치
3. 활성 모델명
4. Permission 모드
5. 세션 메시지 수
6. `/statusline` 설정 명령어

## 참고

- Claude Code: statusline with context, git, model, clickable elements
- 현재 StatusBar 컴포넌트에 일부 데이터 이미 전달 중

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
