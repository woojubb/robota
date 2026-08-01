---
title: Status Line — 실시간 상태 표시줄
status: completed
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

## 리서치

### Claude Code

- 공식 문서 `Customize your status line`은 상태줄을 하단에 표시되는 세션 상태 UI로 정의한다.
- `/statusline` 명령은 상태줄 설정을 만드는 사용자 명령으로 제공된다.
- 상태줄 데이터에는 모델, cwd/workspace, context window, session id/name, git worktree/branch 관련 필드가 포함된다.
- 상태줄 갱신은 새 assistant 메시지, permission mode 변경, vim mode 변경 같은 이벤트에 맞춰 실행되며 로컬 실행이라 토큰을 쓰지 않는다.

### Codex CLI

- 공식 Slash Commands 문서는 `/status`를 현재 세션 구성과 토큰 사용량 확인용으로, `/statusline`을 TUI status-line field 설정용으로 설명한다.
- `/statusline`은 model/context/limits/git/tokens/session 같은 footer item을 고르고 재정렬하는 설정 명령이다.

## 설계 결정

- Robota의 StatusBar는 이미 permission mode, model, context usage, message count, session name, thinking 상태를 표시하므로 git branch와 설정 명령을 추가한다.
- `/statusline`은 CLI 전용 UI 설정 기능이므로 `agent-sdk` 코어 built-in에 하드코딩하지 않는다.
- `agent-cli`가 CLI 전용 `ICommandModule`을 조립해 `InteractiveSession`과 `CommandRegistry`에 주입한다.
- TUI 컴포넌트는 렌더링만 담당한다. git branch 조회와 settings 적용은 CLI utility/side-effect 계층에 둔다.
- 설정은 사용자 설정 `~/.robota/settings.json`의 `statusline` 필드에 저장한다. 기본값은 enabled=true, gitBranch=true 이다.

## 테스트 계획

- Given git branch prop이 전달되면 When StatusBar를 렌더링할 때 Then branch 이름이 표시된다.
- Given git branch 표시가 비활성화되면 When StatusBar를 렌더링할 때 Then branch 이름이 표시되지 않는다.
- Given `/statusline off` 명령을 실행하면 When command result를 확인할 때 Then `statuslinePatch.enabled=false`가 반환된다.
- Given `/statusline git off` 명령을 실행하면 When command result를 확인할 때 Then `statuslinePatch.gitBranch=false`가 반환된다.
- Given side effect에 statusline patch가 있으면 When handler가 실행될 때 Then settings의 `statusline` 값이 병합 저장된다.
- Given git 저장소가 아닌 디렉터리이면 When git branch resolver를 호출할 때 Then `undefined`를 반환한다.

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인

## 완료

- `agent-cli` CLI 전용 `createStatusLineCommandModule()` 추가
- StatusBar에 git branch 표시 추가
- `~/.robota/settings.json`의 `statusline.enabled`, `statusline.gitBranch` 설정 저장/반영
- TUI는 `SessionStatusBar`와 `useStatusLineSettings`로 얇게 유지
- 레거시 slash-executor의 `/memory` routing completeness 누락 수정

## 검증 결과

- `pnpm --filter @robota-sdk/agent-cli test` 통과
- `pnpm --filter @robota-sdk/agent-cli typecheck` 통과
- `pnpm --filter @robota-sdk/agent-cli build` 통과
- `pnpm --filter @robota-sdk/agent-cli lint` 통과 (기존 warning 유지)
- `pnpm harness:scan` 통과
- `pnpm harness:verify -- --scope packages/agent-cli --base-ref origin/develop --skip-record-check` 통과
