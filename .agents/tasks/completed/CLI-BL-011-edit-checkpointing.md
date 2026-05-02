---
title: Edit Checkpointing — 파일 편집 전 스냅샷 + 되돌리기
status: completed
priority: high
urgency: soon
created: 2026-03-26
packages:
  - agent-sdk
  - agent-cli
---

## 요약

파일 편집 시 스냅샷이 없어서 잘못된 편집을 되돌릴 수 없음. git reset만으로는 부족 (커밋 전 변경 손실 위험).

## 기술 검토 (2026-03-26)

### Claude Code

- 프롬프트 단위 체크포인트 (도구 호출 단위 아님)
- Edit/Write 도구 편집만 추적. Bash 명령(rm, mv)은 미추적
- Esc Esc 또는 `/rewind` → 프롬프트 목록에서 선택
- 되돌리기 옵션 4가지: 코드만 / 대화만 / 코드+대화 / 요약
- git 독립. 세션 종료 30일 후 삭제
- 내부 구현 비공개 (파일 스냅샷이라는 것만 언급)

### Cursor

- AI 턴 단위 체크포인트
- rm, mv 등 Bash 파일 조작도 추적
- 로컬 shadow 파일 복사 (VS Code Local History와 유사)
- Composer 패널에서 "Restore Checkpoint" 버튼
- 1턴의 모든 변경을 하나의 논리 단위로 묶음

## 리서치 재검증 (2026-05-02)

- Claude Code 공식 문서: 사용자 프롬프트 단위 체크포인트, `Esc Esc` 또는 `/rewind`, 코드/대화 복원 옵션을 계속 안내한다. <https://docs.claude.com/en/docs/claude-code/checkpointing>
- Claude Code Agent SDK 공식 문서: 파일 체크포인트는 옵션으로 활성화하고, 응답 스트림에서 checkpoint UUID를 받아 파일 복원을 호출하는 API 형태도 제공한다. <https://code.claude.com/docs/en/agent-sdk/file-checkpointing>
- Cursor 공식 문서: Agent 변경 후 자동 checkpoint를 만들고 이전 요청에서 Restore Checkpoint를 제공한다. <https://docs.cursor.com/en/agent/chat/checkpoints>

### 구현 설계

**저장:**

- 프롬프트(턴) 단위로 체크포인트 디렉토리 생성: `.robota/checkpoints/{session-id}/{turn-N}/`
- 각 파일은 그 턴에서 **처음 수정될 때 1회만** 원본 복사 (같은 턴에서 같은 파일 재수정 시 복사 안 함)
- Edit/Write 도구 내부에서 "첫 수정 시 복사" 훅 실행

**복원 알고리즘 (역순 롤백):**

- 턴 N으로 되돌리기 = 현재 턴부터 N+1까지 역순으로 각 체크포인트의 파일을 복원
- 각 단계는 해당 턴에서 수정된 파일의 원본 덮어쓰기
- 100턴 되돌려도 수백 파일 복사 = 수백 밀리초
- 별도 알고리즘 불필요. 단순 역순 반복

**UI 상호작용 (Claude Code 참조):**

트리거:

- `Esc Esc` (두 번 연속) 또는 `/rewind` 명령
- 현재 Robota는 Esc 1회 = abort. Esc Esc를 rewind로 분리 필요

프롬프트 선택:

- 세션의 모든 프롬프트를 스크롤 가능한 목록으로 표시 (ListPicker 재사용)
- 한 단계만이 아니라 아무 지점으로나 이동 가능

선택 후 옵션 (MenuSelect 또는 ConfirmPrompt 재사용):

1. 코드 + 대화 복원
2. 대화만 복원 (코드 유지)
3. 코드만 복원 (대화 유지)
4. 이 시점부터 요약 (코드 변경 없음, 컨텍스트 압축)
5. 취소

복원 후:

- 선택한 시점의 원래 프롬프트가 입력 필드에 자동 입력 (재전송/수정 가능)
- 앞으로 가기 불가 (되돌리기만). 분기 필요 시 `--fork-session` 사용

**정리:**

- 세션 정리 시 체크포인트 함께 삭제 (30일)

**git 관계:**

- 완전 독립. git의 보완재 (커밋 전 안전망)

## 구현 결과 (2026-05-02)

- SDK에 `EditCheckpointStore`와 `Write`/`Edit` 도구 래퍼를 추가했다.
- `InteractiveSession.submit()`의 각 프롬프트 턴마다 체크포인트를 시작하고, 도구가 파일을 처음 수정하기 전에 pre-image를 1회 저장한다.
- `.robota/checkpoints/{session-id}/{turn-id}/manifest.json`과 `files/` 스냅샷을 사용한다.
- `/rewind list`, `/rewind restore <checkpoint-id>`, `/rewind code <checkpoint-id>` 시스템 명령을 추가했다.
- 복원은 선택한 체크포인트 이후 턴을 역순으로 되돌리고, 이후 체크포인트 디렉토리를 제거한다.
- 현재 범위는 `Write`/`Edit` 도구 변경 추적이다. Bash 내부의 `rm`, `mv` 등 셸 파일 조작 추적은 별도 후속 과제로 다룰 수 있다.

## 검증

- `pnpm --filter @robota-sdk/agent-sdk test -- src/checkpoints/__tests__/edit-checkpoint-store.test.ts src/checkpoints/__tests__/edit-checkpoint-tools.test.ts src/interactive/__tests__/interactive-session-checkpoints.test.ts src/commands/__tests__/system-command.test.ts`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-sdk lint` (기존 warning만 존재)
