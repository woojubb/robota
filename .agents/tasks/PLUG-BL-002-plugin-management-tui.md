---
title: PLUG-BL-002 Plugin/Marketplace management TUI
status: backlog
priority: medium
created: 2026-03-23
packages:
  - agent-cli
  - agent-sdk
---

## 요약

마켓플레이스 관리, 플러그인 관리, 설치 위치 선택을 TUI(화살표 선택)로 처리하는 인터랙티브 UI 개발.

## 기능 목록

### 1. 마켓플레이스 관리 TUI

- `/plugin marketplace` → 등록된 마켓플레이스 목록 표시 (화살표로 선택)
- 선택 후 → 하위 메뉴: update / remove
- update: 선택한 마켓플레이스 git pull + manifest 갱신
- remove: 선택한 마켓플레이스 제거 + 해당 플러그인 삭제 확인

### 2. 플러그인 설치 TUI

- `/plugin install` → 마켓플레이스 선택 (화살표)
- 선택 후 → 해당 마켓플레이스의 플러그인 목록 표시 (화살표)
- 선택 후 → 설치 위치 선택:
  - `~/.robota/plugins/` (전역, 모든 프로젝트)
  - `.robota/plugins/` (프로젝트 로컬)
- 확인 후 설치 진행

### 3. 플러그인 관리 TUI

- `/plugin` (인자 없이) → 설치된 플러그인 목록 표시 (화살표로 선택)
- 선택 후 → 하위 메뉴: enable / disable / uninstall
- enable/disable: 토글
- uninstall: 확인 후 제거

## 구현 방향

- ink-select-input 활용 (이미 permission prompt에서 사용 중)
- 다단계 선택: 1단계 목록 → 2단계 액션 → 3단계 확인
- 현재 텍스트 기반 `/plugin install name@marketplace` 방식은 유지 (shortcut)
- TUI는 인자 없이 호출할 때 인터랙티브 모드로 동작
