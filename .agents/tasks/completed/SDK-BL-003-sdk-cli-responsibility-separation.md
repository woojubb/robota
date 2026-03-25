---
title: SDK/CLI 책임 분리 — InteractiveSession, SystemCommand, CommandRegistry
status: completed
priority: high
created: 2026-03-25
completed: 2026-03-25
packages:
  - agent-sdk
  - agent-cli
---

## 요약

CLI에 있던 핵심 로직을 SDK로 이동하여 CLI를 순수 TUI 레이어로 분리.

## 완료 항목

1. **InteractiveSession** (SDK) — 이벤트 기반 세션 래퍼. Session을 composition으로 래핑. 스트리밍 축적, 도구 상태 추적, 프롬프트 큐, abort, 메시지 히스토리.
2. **SystemCommandExecutor + ISystemCommand** (SDK) — 순수 TypeScript 시스템 명령어 실행. help, clear, compact, mode, model, language, cost, context, permissions, reset.
3. **CommandRegistry + BuiltinCommandSource + SkillCommandSource** (SDK) — 명령어 발견/등록. CLI에서 SDK로 이동.
4. **useInteractiveSession** (CLI) — InteractiveSession 이벤트 → React state 변환. 유일한 React↔SDK 브릿지.
5. **기존 hooks 삭제** — useSession, useSubmitHandler, useSlashCommands, useCommandRegistry, useMessages.
6. **행동 테스트** — 11개 시나리오 기반 테스트 (리팩토링에서 살아남는 테스트).

## 설계 문서

- `.design/sdk-cli-responsibility-separation.md`
- `.design/agent-transport-architecture.md`
