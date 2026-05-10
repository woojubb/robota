---
title: 'ARCH-FIX-013: createModeCommandModule SPEC-코드-맵 3자 불일치 해소'
status: todo
created: 2026-05-10
priority: medium
urgency: backlog
area: documentation
related: [V-CLI-002, CLI2-008]
---

## Problem

`agent-cli/docs/SPEC.md` 라인 265에 `createModeCommandModule (from @robota-sdk/agent-command-mode)`가 명시되어 있으나:

- `composition-tree.md`에 해당 항목 없음
- `agent-cli/package.json`에 `@robota-sdk/agent-command-mode` 의존성 없음
- `cli.ts`에 해당 임포트 없음

SPEC, 아키텍처 맵, 코드 세 곳이 불일치하는 `common-mistakes.md` #45 위반이다. `CLI2-008`(agent-command-mode orphan 패키지) 백로그와 연관이 있다.

## Solution

두 가지 선택지 중 하나를 확정해야 한다:

**Option A**: `createModeCommandModule`을 실제로 CLI에 연결한다.

- `agent-cli/package.json`에 `@robota-sdk/agent-command-mode` 의존성 추가
- `cli.ts`에 임포트 및 등록
- `composition-tree.md` 업데이트

**Option B**: SPEC.md에서 해당 항목을 제거한다 (기능이 필요 없는 경우).

- SPEC.md에서 `createModeCommandModule` 제거
- `agent-command-mode` 패키지 처분 방향 결정 (CLI2-008과 연계)

이 결정은 `CLI2-008` 백로그와 함께 처리한다.

## Test Plan

- Option A: `pnpm build` 통과, `cli.ts` 임포트 확인, `composition-tree.md` 일치 확인
- Option B: SPEC.md, composition-tree.md, package.json 모두에서 항목 제거 확인

## User Execution Test Scenarios

Not applicable — result depends on option chosen. If Option A (code change): mode command behavior should be tested. If Option B (doc change): not applicable.

## Verification Evidence

(완료 후 선택한 옵션과 변경 내용 기록)
