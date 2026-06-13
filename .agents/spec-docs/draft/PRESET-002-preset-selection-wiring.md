---
status: draft
type: FLOW
tags: [cli]
---

# PRESET-002: --preset 선택 배선 — 플래그 + settings 기본 + 조립 주입(무회귀)

## Problem

PRESET-001이 `IPreset` 계약과 `resolvePreset()`(우선순위 병합 포함)를 제공하더라도, `agent-cli`에는
프리셋을 **선택해 프레임워크 조립에 전달**할 껍데기 배선이 없다. 사용자가 실행 시 `--preset`를 고를 수
없고, `settings.preset` 기본값을 읽지 못하며, `resolvePreset()`가 돌려준 프레임워크 옵션이 기존 조립
진입점(composition root)으로 전달되지 않는다.

**재현 조건:** `robota --preset default` 실행 시 `--preset`는 알 수 없는 플래그로 무시되거나 오류.
`rg "preset" packages/agent-cli/src/utils/cli-args.ts` → 매치 없음. `rg "preset" packages/agent-framework/src/config/config-types.ts` → `SettingsSchema`에 `preset` 필드 없음.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §5(agent-cli는 껍데기), §5.2(우선순위), §6.1(매트릭스), §7.

## Architecture Review

### Affected Scope

agent-cli는 **순수 껍데기**다. 선택/우선순위/병합/기능 로직은 일절 두지 않는다(설계 §5 레이어 책임).
우선순위 병합은 전부 `agent-preset.resolvePreset` **내부**에서 일어난다.

- `packages/agent-cli/src/utils/cli-args.ts` — `--preset <id>` 플래그 **파싱만**(`IParsedCliArgs.preset`). 해석/검증 없음.
- `packages/agent-cli/src/cli.ts` — `settings.preset` **읽기** → preset id 선택(CLI 플래그 > settings > `'default'`) → `resolvePreset(id, { cliOverrides })` **호출** → 반환된 프레임워크 옵션을 기존 조립 진입점(composition root 배선)으로 **그대로 전달** → 활성 프리셋 표시. 병합·precedence 로직 없음.
- `packages/agent-framework/src/config/config-types.ts` — `SettingsSchema`에 `preset?: string` 필드 추가(껍데기가 읽을 값의 SSOT).
- 소비: `@robota-sdk/agent-preset`의 `resolvePreset`(우선순위 병합 소유)/`listPresets`(unknown preset 오류 메시지 콘텐츠 소유) (PRESET-001).

> `startup/command-setup.ts`는 영향 범위에서 제외한다 — 병합/주입 로직을 cli 합성 루트에 두지 않기 때문. cli.ts는 resolvePreset 결과를 기존 조립 진입점에 전달하기만 한다.

### Alternatives Considered

1. **agent-cli(또는 command-setup.ts)에서 프리셋 해석 + 우선순위 병합 수행.**
   - Pro: 기존 `IStartCliOptions` 주입 지점에 가까워 배선 단순.
   - Con: 선택/precedence/merge 기능 로직이 껍데기 레이어로 누수 — 설계 §5 레이어 불변식 위반. SDK 사용자가 동일 병합을 재현 못 함. Rejected.
2. **우선순위 병합을 `agent-preset.resolvePreset` 내부에 두고, agent-cli는 파싱·읽기·호출·전달·표시만.**
   - Pro: 레이어 책임 준수(cli=껍데기); SDK 사용자도 `resolvePreset`로 동일 결과 획득; CLI 플래그>settings>preset>기본값 precedence가 단일 소유처(agent-preset)에 집중; 모든 실행 모드(TUI/print)가 동일 결과 옵션을 받음.
   - Con: cli가 cliOverrides를 resolvePreset에 넘기는 인자 형태를 PRESET-001 계약과 맞춰야 함.

### Decision

**Alternative 2.** 우선순위 병합(명시 옵션/SDK > CLI 플래그 > 프리셋 값 > 프레임워크 기본값)은
`agent-preset.resolvePreset(id, { cliOverrides })` **내부**에서 수행한다. agent-cli는 `--preset` 파싱,
`settings.preset` 읽기, id 선택(플래그 > settings > `'default'`), `resolvePreset` 호출, 반환된 프레임워크
옵션을 기존 조립 진입점으로 전달, 활성 프리셋 표시만 한다. unknown preset의 오류 메시지 콘텐츠(사용 가능
id 목록)는 `listPresets()`가 소유하고 cli는 표면화만 한다. 프리셋 미지정 또는 `default` 지정 시 현재 동작과
동일(무회귀). 트레이드오프: cliOverrides 전달 형태를 PRESET-001 계약에 맞추는 대신, 기능 로직을 적정 레이어에
격리하고 SDK/CLI가 동일 precedence를 공유한다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-cli(파싱/읽기/호출/전달 껍데기), agent-framework(SettingsSchema.preset), agent-preset 소비(resolvePreset/listPresets)
- [x] Sibling scan 완료 — agent-cli `{--model, --system-prompt, --language}` 기존 플래그 파싱·전달 경로 확인 후 `--preset` 파싱에 동일 패턴 적용(해석은 하지 않음)
- [x] 대안 최소 2개 검토 완료 — 2개 검토(cli에서 병합 vs resolvePreset 내부 병합)
- [x] 결정 근거 문서화 완료 — 레이어 불변식 + precedence 단일 소유처 + 무회귀 근거 기록

## Solution

1. `cli-args.ts`에 `--preset <id>` **파싱만** 추가(`IParsedCliArgs.preset`). 검증/해석 없음.
2. `agent-framework`의 `SettingsSchema`에 `preset?: string` 추가.
3. `cli.ts`에서 `settings.preset`를 읽고 preset id 선택: CLI 플래그 > `settings.preset` > `'default'`.
4. `cli.ts`가 `resolvePreset(id, { cliOverrides })`를 **호출**한다. 우선순위 병합(명시 옵션 > CLI 플래그 >
   프리셋 > 기본값)은 `agent-preset` 내부에서 일어난다 — cli는 병합하지 않는다.
5. `resolvePreset()`가 돌려준 프레임워크 옵션을 기존 조립 진입점(composition root 배선)으로 **그대로 전달**한다.
6. 알 수 없는 preset id → `listPresets()`가 제공하는 사용 가능 id 목록을 포함한 오류를 cli가 **표면화**하고 비정상 종료. 메시지 콘텐츠는 agent-preset 소유.

## Affected Files

- `packages/agent-cli/src/utils/cli-args.ts` — `--preset` 플래그 파싱
- `packages/agent-cli/src/cli.ts` — settings.preset 읽기 + resolvePreset 호출 + 결과 전달 + 활성 표시
- `packages/agent-framework/src/config/config-types.ts` — `SettingsSchema`에 `preset?: string`

## Completion Criteria

- [ ] TC-01: `robota --preset default -p "ping"` 종료 코드가 `robota -p "ping"`(플래그 없음)과 동일(둘 다 exit 0)이고 동일 경로 실행 — 무회귀
- [ ] TC-02: `robota --preset __nope__ -p "ping"` → 비-0 종료, stderr에 `listPresets()`가 제공하는 사용 가능 preset id 목록(`default` 포함) 출력
- [ ] TC-03: settings.json에 `"preset": "default"` 설정 + `--preset` 플래그 미지정 시 cli가 settings 값을 읽어 `resolvePreset('default', ...)`로 default가 적용됨을 단언하는 통합 테스트 통과
- [ ] TC-04: settings `preset` 값과 다른 `--preset` 플래그를 동시 지정 시 cli가 플래그 값을 id로 선택함(`resolvePreset`가 플래그 id로 호출됨)을 단언하는 통합 테스트 통과
- [ ] TC-05: `resolvePreset()`가 돌려준 프레임워크 옵션의 `model`이 cli를 거쳐 기존 조립 진입점(framework assembly)으로 그대로 전달됨을 단언하는 통합 테스트 통과
- [ ] TC-06: `pnpm --filter @robota-sdk/agent-cli build` + `pnpm typecheck` → exit 0

## Test Plan

Type FLOW + tags cli → 프로세스 통합 테스트(spawn + 종료코드/출력 단언) + 빌드·타입 스모크.

| TC-ID | Test Type              | Tool / Approach                                             | Notes    |
| ----- | ---------------------- | ----------------------------------------------------------- | -------- |
| TC-01 | FLOW (cli)             | 프로세스 spawn, 두 실행 종료코드 비교                       | 커맨드폼 |
| TC-02 | FLOW (cli)             | 프로세스 spawn, stderr에 listPresets id 목록 단언           | 커맨드폼 |
| TC-03 | FLOW (cli)             | 통합 테스트 — settings fixture + resolvePreset id 단언      |          |
| TC-04 | FLOW (cli)             | 통합 테스트 — 플래그 id가 settings id보다 우선 선택됨 단언  |          |
| TC-05 | FLOW (cli)             | 통합 테스트 — resolve된 model이 조립 진입점으로 전달됨 단언 |          |
| TC-06 | CI pipeline smoke test | `pnpm --filter ... build` + `pnpm typecheck` exit code      | 커맨드폼 |

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

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter: `---` block present; `status: draft`; `type: FLOW` (valid 11-prefix value); `tags: [cli]` present.
Problem: concrete symptom (`robota --preset default` ignored/error; `rg "preset" cli-args.ts` no match; `SettingsSchema` lacks `preset`) + reproduction condition (exact rg/run commands); no TBD/TODO/vague.
Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` with evidence (existing `--model/--system-prompt/--language` parse path); Alternatives Considered has 2 entries each with Pro/Con; Decision states the trade-off (cliOverrides arg-shape vs layer isolation + shared precedence).
Completion Criteria: TC-01..TC-06 all TC-N prefixed; command/observable form; no banned phrases ("works correctly"/"no errors"/"implemented"/"displays correctly").
Test Plan: section present; 6 rows (TC-01..TC-06) match 6 TC-N count; every row has non-empty Test Type + Tool/Approach, no "TBD"; no row uses Tool "manual" so Notes-justification criterion is N/A.
Structure: Tasks section present with placeholder (`.agents/tasks/PRESET-002.md` — 미생성); Evidence Log present and empty before this run; no `## Status` or `## Classification` body sections.
