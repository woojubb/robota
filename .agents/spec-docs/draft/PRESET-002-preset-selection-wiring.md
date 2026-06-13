---
status: draft
type: FLOW
tags: [cli]
---

# PRESET-002: --preset 선택 배선 — 플래그 + settings 기본 + 조립 주입(무회귀)

## Problem

PRESET-001이 `IPreset` 계약과 `resolvePreset()`를 제공하더라도, `agent-cli`에는 프리셋을 **선택해
조립에 주입**할 경로가 없다. 사용자가 실행 시 프리셋을 고를 수 없고, resolve된 프리셋 값이
`buildCommandSetup`/세션 옵션 seam으로 흘러가지 않는다.

**재현 조건:** `robota --preset default` 실행 시 `--preset`는 알 수 없는 플래그로 무시되거나 오류.
`rg "preset" packages/agent-cli/src/utils/cli-args.ts` → 매치 없음. settings.json에 `preset` 필드 없음.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §5.2, §5.3.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/utils/cli-args.ts` — `--preset <id>` 파싱(`IParsedCliArgs.preset`)
- `packages/agent-cli/src/cli.ts` — preset 해석 후 `buildCommandSetup` 옵션에 병합
- `packages/agent-cli/src/startup/command-setup.ts` — resolve된 프리셋 옵션을 기존 seam에 주입
- `packages/agent-framework/src/config/config-types.ts` — `SettingsSchema`에 `preset?: string`
- 소비: `@robota-sdk/agent-preset`의 `resolvePreset`/`listPresets` (PRESET-001)

### Alternatives Considered

1. **세션 레벨에서만 프리셋 주입(`createInteractiveSession` 옵션).**
   - Pro: SDK 사용자에 자연스러움.
   - Con: 명령 모듈 목록 선택(buildCommandSetup)은 CLI 합성 루트에서 결정됨 — 세션 레벨만으로는
     모듈 선택을 못 함. 프리셋이 레이어에 흩어짐. Rejected(단독으로는).
2. **CLI 합성 루트(`startCli`/`buildCommandSetup`)에서 프리셋 해석 후 기존 seam 주입.**
   - Pro: 모든 실행 모드(TUI/print) 일괄 적용; 기존 `IStartCliOptions` 주입 패턴 재사용; CLI 플래그가
     프리셋을 덮어쓰는 우선순위 자연 구현.
   - Con: CLI 인자 파싱 추가 필요.

### Decision

**Alternative 2.** CLI 합성 루트에서 `--preset`/settings로 프리셋을 해석하고 `resolvePreset()` 결과를
`buildCommandSetup`/세션 옵션 seam에 주입한다. 우선순위 = 명시 옵션 > CLI 플래그 > 프리셋 > 기본값.
프리셋 미지정 또는 `default` 지정 시 현재 동작과 동일(무회귀). 트레이드오프: 인자 파싱 추가를 감수하고
모든 모드 일괄 적용 + 우선순위 일관성을 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-cli(인자/합성), agent-framework(SettingsSchema), agent-preset 소비
- [x] Sibling scan 완료 — agent-cli `{--model, --system-prompt, --language}` 기존 플래그 파싱·우선순위 경로 확인 후 동일 패턴 적용
- [x] 대안 최소 2개 검토 완료 — 2개 검토
- [x] 결정 근거 문서화 완료 — 우선순위 규칙 + 무회귀 근거 기록

## Solution

1. `cli-args.ts`에 `--preset <id>` 파싱 추가.
2. `cli.ts`에서 preset id 해석: CLI 플래그 > `settings.preset` > `'default'`. `resolvePreset(id, base)`로
   프레임워크 옵션 부분집합 생성.
3. resolve된 옵션을 `buildCommandSetup`/세션 옵션에 병합하되, **CLI 명시 플래그(`--model` 등)가 프리셋
   값을 덮어쓰도록** 병합 순서를 보장.
4. `SettingsSchema`에 `preset?: string` 추가.
5. 알 수 없는 preset id → `listPresets()` 목록과 함께 명확한 오류 + 비정상 종료.

## Affected Files

- `packages/agent-cli/src/utils/cli-args.ts`
- `packages/agent-cli/src/cli.ts`
- `packages/agent-cli/src/startup/command-setup.ts`
- `packages/agent-framework/src/config/config-types.ts`

## Completion Criteria

- [ ] TC-01: `robota --preset default -p "ping"` 종료 코드가 `robota -p "ping"`(플래그 없음)과 동일(둘 다 exit 0)이고 동일 경로 실행 — 무회귀
- [ ] TC-02: `robota --preset __nope__ -p "ping"` → 비-0 종료, stderr에 사용 가능한 preset id 목록(`default` 포함) 출력
- [ ] TC-03: settings.json에 `"preset": "default"` 설정 + 플래그 미지정 시 default가 적용됨을 단언하는 통합 테스트 통과
- [ ] TC-04: settings `preset` 값과 다른 `--preset` 플래그를 동시 지정 시 플래그 값이 채택됨을 단언하는 통합 테스트 통과
- [ ] TC-05: resolve된 프리셋의 `model`이 `buildCommandSetup` 경로로 전달됨을 단언하는 통합 테스트 통과
- [ ] TC-06: `pnpm --filter @robota-sdk/agent-cli build` + `pnpm typecheck` → exit 0

## Test Plan

Type FLOW + tags cli → 프로세스 통합 테스트(spawn + 종료코드/출력 단언) + 빌드·타입 스모크.

| TC-ID | Test Type              | Tool / Approach                                        | Notes    |
| ----- | ---------------------- | ------------------------------------------------------ | -------- |
| TC-01 | FLOW (cli)             | 프로세스 spawn, 두 실행 종료코드 비교                  | 커맨드폼 |
| TC-02 | FLOW (cli)             | 프로세스 spawn, stderr 목록 단언                       | 커맨드폼 |
| TC-03 | FLOW (cli)             | 통합 테스트 — settings fixture + 적용 단언             |          |
| TC-04 | FLOW (cli)             | 통합 테스트 — 플래그 vs settings 우선순위              |          |
| TC-05 | BEHAVIOR               | 통합 테스트 — buildCommandSetup 전달값 단언            |          |
| TC-06 | CI pipeline smoke test | `pnpm --filter ... build` + `pnpm typecheck` exit code | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 1 — 무회귀 확인:** 전제: 프로바이더 1개 설정된 로컬 환경. 실행:
  `robota --preset default -p "say hi"` 와 `robota -p "say hi"` 를 각각 실행. 기대: 두 출력/종료
  동작이 동일(프리셋 도입 전과 차이 없음). 정리: 없음. Evidence: 두 실행의 종료코드 + 출력 캡처(구현 후 기록).
- **시나리오 2 — 잘못된 프리셋:** 실행: `robota --preset does-not-exist -p "hi"`. 기대: 비정상 종료 +
  사용 가능한 프리셋 목록(`default`) 안내 메시지. Evidence: 콘솔 출력 + 종료코드 캡처(구현 후 기록).

환경: 별도 fixture 불필요 — 기존 로컬 설정으로 실행 가능.

## Tasks

- [ ] `.agents/tasks/PRESET-002.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
