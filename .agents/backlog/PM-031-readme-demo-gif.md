---
title: 'PM-031: README 데모 GIF/스크린샷 추가'
status: todo
created: 2026-05-24
priority: high
category: marketing
---

## Progress (PROC-001 reconciliation, 2026-07-25)

Reopened: **the README currently ships a broken image.** PR #589 added the README reference
(`packages/agent-cli/README.md` L62 `![Demo](./docs/demo.gif)`) plus `docs/DEMO-SCRIPT.md`, but
`packages/agent-cli/docs/demo.gif` is still a 41-byte placeholder — it renders as a broken image
on GitHub/npm. Remaining: record the real GIF per DEMO-SCRIPT.md (agent-runnable via the PTY/TUI
e2e harness + asciinema/agg), or remove the reference until one exists.

## 문제

README에 TUI가 어떻게 생겼는지 이미지가 전혀 없다.
Aider, Claude Code 등 경쟁 도구는 모두 데모 GIF를 README 상단에 보유한다.
텍스트만으로는 처음 보는 개발자가 "이 도구가 어떻게 생겼는지" 알 수 없다.

## 해결 방법

1. `asciinema` 또는 `terminalizer`로 TUI 세션 녹화
2. `agg`(asciinema gif generator) 또는 `terminalizer render`로 GIF 생성
3. README 설치 섹션 바로 아래에 삽입

**녹화 시나리오 (2분 이내):**

```
robota
> Explain the main entry point of this project
[에이전트가 파일을 읽고 설명하는 장면]
```

**참고 도구:**

- `npx asciinema rec demo.cast`
- `npx agg demo.cast demo.gif`

## 수용 기준

- [ ] README 상단(설치 직후)에 데모 GIF 또는 스크린샷 삽입
- [ ] GIF 크기 5MB 이하
- [ ] TUI의 실제 코딩 어시스턴트 동작이 보임

## 예상 작업 시간

2시간 이내
