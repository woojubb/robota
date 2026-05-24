---
title: 'PM-023: 첫 실행 온보딩 가이드 — "무엇을 먼저 물어볼까" 안내'
status: todo
created: 2026-05-24
priority: high
urgency: now
area: packages/agent-cli, packages/agent-transport-tui
depends_on: []
---

## Background

사용자는 `npx @robota-sdk/agent-cli`를 처음 실행하고 빈 프롬프트 앞에서 멈춘다. "뭘 물어봐야 하지?"가 막히면 그냥 닫는다. Claude Code는 이 문제를 첫 실행 시 suggested actions와 예제 프롬프트로 해결한다.

target persona:

- 새로운 프로젝트를 막 클론한 백엔드 개발자
- CI 자동화를 추가하려는 DevOps 엔지니어
- "AI 코딩 도구 써봐야지" 하는 호기심으로 들어온 개발자

## 작업 항목

### 첫 실행 감지

- `~/.robota/first_run` 파일 존재 여부로 첫 실행 감지
- 첫 실행 시 온보딩 배너 표시, 이후 자동 억제

### 온보딩 배너 내용 (TUI)

```
✦ Robota에 오신 것을 환영합니다!

  무엇을 도와드릴까요? 예를 들어:
  • "이 프로젝트 구조를 설명해줘"
  • "TODO 주석이 있는 파일을 찾아줘"
  • "pnpm test 실행하고 실패한 테스트를 분석해줘"
  • "최근 변경된 파일 목록을 보여줘"

  /help 를 입력하면 모든 명령어를 볼 수 있습니다.
```

### `/help` 명령 개선

- 현재 `/help` 가 있는지 확인, 없으면 추가
- 슬래시 커맨드 목록 + 예제 프롬프트 10개 이상

### 프로젝트 컨텍스트 자동 감지

- `package.json`, `Cargo.toml`, `go.mod` 등 감지 → 프로젝트 타입별 맞춤 프롬프트 제안
- Git 저장소 감지 → "최근 변경사항 설명해줘" 프롬프트 추가

## 성공 기준

- 첫 실행 시 온보딩 배너 표시
- 두 번째 실행부터 배너 없음
- `/help`로 예제 프롬프트 10개 이상 확인
- 배너 내 예제 중 하나를 복사해서 바로 사용 가능
