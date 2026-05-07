# SDK-BL-004: Ralph Loop Support (Non-interactive Agentic Loop)

- **Status**: completed
- **Created**: 2026-05-04
- **Branch**: feat/cli-selected-backlogs
- **Scope**: packages/agent-cli, packages/agent-sdk

## What

Ralph Loop를 Robota CLI에서 구동할 수 있도록 필요한 인프라를 추가한다.

Ralph Loop는 새로운 에이전트 루프 알고리즘이 아니다. **컨텍스트 윈도우 관리 전략**이다:

- 매 반복마다 컨텍스트를 완전히 초기화하고 CLI를 새로 실행
- LLM이 아닌 파일시스템/git이 반복 간 상태를 보존
- 외부 bash/script가 종료 코드를 보고 반복 여부를 결정

즉, SDK/CLI는 "**한 번의 agentic turn을 비대화형으로 실행하고 상태 코드로 결과를 알린다**"까지만 책임진다.
반복 루프 자체는 사용자 레포의 스크립트가 담당한다.

## 책임 분리

### SDK/CLI가 제공해야 할 것 (이 태스크의 범위)

| 기능                        | 설명                                                             |
| --------------------------- | ---------------------------------------------------------------- |
| 비대화형 단일 실행          | `robota -p "태스크"` — TUI 없이 실행 후 종료 (CLI-BL-017과 연동) |
| 완료 신호 exit code         | 0 = turn 정상 완료, 1 = 오류 (외부 스크립트가 반복 여부 판단)    |
| `--bare` + `--allowedTools` | 사전 승인 툴 목록, 스킬/플러그인/MCP 탐색 스킵 옵션              |
| `--no-session-persistence`  | 비대화형 실행 시 세션 저장 불필요                                |
| 태스크 파일 명시 주입       | `--task-file <path>`로 지정한 파일을 시스템 프롬프트에 포함      |

### 사용자 레포가 담당할 것 (이 태스크의 범위 외)

```bash
# 사용자 레포의 loop.sh 예시
for i in $(seq 1 $MAX_ITER); do
  robota -p "$(cat task.md)" --bare --allowedTools bash,read,write
  EXIT=$?
  [ $EXIT -eq 1 ] && echo "오류" && exit 1
  # exit 0 = turn 완료. 계속할지는 스크립트가 직접 판단
  # (출력 파싱, 센티넬 파일 확인, 반복 횟수 체크 등)
done
```

## Ralph Loop의 핵심 원리 (설계 근거)

**Ralph Wiggum Technique**: "LLM이 모든 걸 기억하게 하지 말고, 매 반복마다 현재 파일 상태를 다시 읽게 하라."

|              | 일반 루프                       | Ralph Loop                       |
| ------------ | ------------------------------- | -------------------------------- |
| 상태 유지    | 컨텍스트 창 누적                | 파일시스템 / git                 |
| 반복 방식    | 같은 컨텍스트 내 tool_call 반복 | 매 반복마다 컨텍스트 완전 초기화 |
| 컨텍스트 rot | 컨텍스트가 차면 성능 저하       | 항상 "스마트 존"에서 시작        |
| 메모리 주체  | LLM                             | 파일/git                         |

컨텍스트 누적으로 인한 성능 저하 없이 장시간 작업(수십 반복)이 가능해진다.

## 선행 조건

- **CLI-BL-017** (non-interactive 고급 기능: `--bare`, `--allowedTools`, `--no-session-persistence`) 완료 후 진행

## Design Decisions

- `--task-file <path>`를 명시 플래그로 제공한다. 자동 탐지는 루프 재현성을 떨어뜨리고 사용자 레포의 파일명 관례를 CLI에 숨겨진 정책으로 굳힐 수 있으므로 제외한다.
- 반복 간 컨텍스트 전달은 이 태스크 범위에서 제외한다. Ralph Loop의 핵심은 매 반복마다 컨텍스트를 초기화하고 파일시스템/git을 상태 저장소로 쓰는 것이므로, 이전 반복 요약 주입은 별도 명시 옵션이 필요해질 때 다시 설계한다.

## Acceptance Criteria

- [x] `robota -p "task"` 비대화형 실행 후 exit 0 (정상) / exit 1 (오류) 반환
- [x] 오류(uncaught exception, provider error) 시 exit 1
- [x] `--bare`: AGENTS.md/CLAUDE.md 로딩 스킵, 플러그인 로딩 스킵
- [x] `--allowedTools bash,read,write`: 지정 툴 권한 프롬프트 없이 자동 승인
- [x] `--no-session-persistence`: 세션 파일 저장 안 함
- [x] `--task-file <path>`: 태스크 파일 내용을 비대화형 실행 시스템 프롬프트에 주입
- [x] 기존 interactive 모드에 영향 없음 (regression 없음)

## Test Plan

- Added focused CLI tests for task-file injection, non-interactive execution, allowed tools, bare mode, and disabled session persistence.
- Added SDK regression tests that confirm bare mode and no-session-persistence behavior remains intact.
- Ran targeted CLI/SDK tests, builds, typecheck, lint, and provider-free `cli:dev` smoke verification.

## References

- [Ralph Wiggum Loop — beuke.org](https://beuke.org/ralph-wiggum-loop/)
- [Inventing the Ralph Wiggum Loop](https://devinterrupted.substack.com/p/inventing-the-ralph-wiggum-loop-creator)
- [The Ralph Wiggum Approach: Running AI Agents for Hours](https://dev.to/sivarampg/the-ralph-wiggum-approach-running-ai-coding-agents-for-hours-not-minutes-57c1)
- [Mastering Ralph Loops — LinearB](https://linearb.io/blog/ralph-loop-agentic-engineering-geoffrey-huntley)
- [Ralph Loop Pattern — ASDLC.io](https://asdlc.io/patterns/ralph-loop/)
- [Agent Loop — OpenClaw Docs](https://docs.openclaw.ai/concepts/agent-loop)
- [Oh My Codex (OMX) — GitHub](https://github.com/Yeachan-Heo/oh-my-codex)

## Promotion Path

1. Open design questions resolved.
2. CLI-BL-017 confirmed complete.
3. Implementation completed in `feat/cli-selected-backlogs`.

## Result

Completed. The CLI now supports explicit `--task-file <path>` injection for reproducible non-interactive loops, keeps existing `-p`, `--bare`, `--allowed-tools`, and `--no-session-persistence` behavior covered by tests, and leaves multi-iteration loop policy to external scripts.
