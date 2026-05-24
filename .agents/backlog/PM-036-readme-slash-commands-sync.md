---
title: 'PM-036: README 슬래시 커맨드 목록 실제 구현과 동기화'
status: todo
created: 2026-05-24
priority: medium
category: documentation
---

## 문제

README에는 12개 슬래시 커맨드가 문서화되어 있지만,
실제 코드에는 10개가 추가로 구현되어 있어 **총 10개 커맨드가 README에 없다**.

**README에 없는 구현된 커맨드:**

- `/mode` — 권한 모드 전환
- `/memory` — 메모리 관리
- `/provider` — 프로바이더 전환 (CLI-025에서 구현)
- `/rewind` — 세션 되감기
- `/settings` — 설정 조회/변경
- `/skills` — 스킬 목록
- `/statusline` — 상태바 설정
- `/background` — 백그라운드 작업
- `/reset` — 설정 초기화
- `/validate-session` — 세션 검증 (내부용)

## 해결 방법

1. 사용자가 직접 사용하는 커맨드는 README에 추가
2. 내부 커맨드(`/validate-session` 등)는 문서화에서 제외
3. README 슬래시 커맨드 섹션 재구성 — 카테고리별 그룹핑

## 수용 기준

- [ ] README의 슬래시 커맨드 목록이 실제 `/help` 출력과 일치
- [ ] `/provider`, `/mode`, `/rewind`, `/settings`, `/memory` 문서화됨
- [ ] 내부 커맨드 (`/validate-session`) 제외 여부 결정

## 관련 파일

- `packages/agent-cli/README.md`
- `packages/agent-command/src/*/`
