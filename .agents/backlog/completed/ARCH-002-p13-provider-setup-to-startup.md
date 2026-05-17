---
title: 'ARCH-002-p13: provider-setup.ts → src/startup/provider-startup.ts'
status: done
created: 2026-05-17
priority: medium
urgency: soon
area: packages/agent-cli
---

# ARCH-002-p13 — provider-setup.ts를 startup/ 디렉토리로 이동

## Context

CLI-AUDIT-013. `src/utils/provider-setup.ts`는 startup-phase 오케스트레이션 로직을
포함하지만 `utils/` 디렉토리에 위치한다. `utils/`는 `cli-args.ts`, `cli-input.ts`,
`provider-default-definitions.ts` 같은 파싱/입력/상수 파일 위치로, startup 오케스트레이션과
맞지 않는다.

## 수정 방법

`src/utils/provider-setup.ts` → `src/startup/provider-startup.ts`

import 경로 업데이트:

- `cli.ts` — `'./utils/provider-setup.js'` → `'./startup/provider-startup.js'`
- 테스트 파일들

## Acceptance Criteria

- `src/utils/provider-setup.ts` 삭제
- `src/startup/provider-startup.ts` 동일 exports
- `pnpm --filter @robota-sdk/agent-cli typecheck` 통과
- `pnpm --filter @robota-sdk/agent-cli test` 전체 통과
