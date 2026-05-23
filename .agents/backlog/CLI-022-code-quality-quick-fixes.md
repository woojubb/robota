---
title: 'CLI-022: 코드 품질 quick-fixes bundle (4개 소항목)'
status: done
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-framework
depends_on: []
---

## Background

기술 검토에서 발견된 소규모 수정 항목 4개를 번들로 처리한다. 각각 독립적이고 영향 범위가 좁다.

## 작업 항목

### QF-1: `--dry-run` help 텍스트 수정

**위치:** `packages/agent-cli/src/utils/cli-args.ts:75`

`--dry-run <prompt>`라고 명시되어 있어 `<prompt>`가 `--dry-run`의 인자인 것처럼 보인다. 실제로 `--dry-run`은 boolean 플래그이고 prompt는 positional 인자로 전달된다.

수정: `--dry-run` (플래그, 이후 prompt를 positional로 전달)으로 help 텍스트 수정 및 사용 예시 추가.

### QF-2: `InteractiveSession.shutdown()` 시 listeners 정리

**위치:** `packages/agent-framework/src/interactive/interactive-session.ts:288-302`

`shutdown()` 완료 후 `this.listeners.clear()`를 호출하지 않는다. 긴 세션에서 이벤트 핸들러가 많이 등록된 경우 GC 대상이 되지 않을 수 있다.

수정: `shutdown()` 마지막에 `this.listeners.clear()` 추가.

### QF-3: `--api-key` plain text 저장 경고 추가

**위치:** `packages/agent-framework/src/command-api/provider/provider-settings.ts:158-164`

`--api-key sk-...` 플래그로 제공한 API 키가 `settings.json`에 plain text로 저장되는데 경고가 없다. `--api-key-env`를 사용하는 것이 더 안전하다.

수정: plain text 저장 경로에 `console.warn("API key stored as plain text. Use --api-key-env for better security.")` 추가.

### QF-4: `agent-cli/tsup.config.ts` dead artifact 삭제

**위치:** `packages/agent-cli/tsup.config.ts`

tsdown으로 마이그레이션 후 남아있는 구 tsup 설정 파일. 빌드 스크립트는 tsdown만 호출하므로 이 파일은 실행되지 않는다.

수정: 파일 삭제.

## Test Plan

- `robota --help` 출력에서 `--dry-run` 설명 확인
- `--api-key` 사용 시 경고 메시지 출력 확인
- `tsup.config.ts` 삭제 후 `pnpm build` 정상 통과 확인
- `pnpm typecheck && pnpm test` 통과 확인

## User Execution Test Scenarios

### Scenario 1: --api-key 경고 확인

```bash
robota --configure-provider anthropic --type anthropic --api-key sk-test123 --set-current
```

Expected: API key plain text 저장 경고 메시지 출력
