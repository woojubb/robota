---
status: done
type: FLOW
tags: [cli]
---

# PRESET-007: 사용자 작성/외부 프리셋 로딩 (파일/npm)

## Problem

빌트인 프리셋(PRESET-005~)만으로는 사용자가 자신만의 개성 프리셋을 만들 수 없다. 팀/개인이 페르소나·
권한·모듈 번들을 직접 정의해 공유하려면 **파일 또는 패키지에서 프리셋을 로딩**하는 경로가 필요하다.
이는 핵심 기능이 아니라 인프라(001~006)가 안정된 뒤의 확장이다.

**재현 조건:** `~/.robota/presets/*.{json,md}` 같은 사용자 프리셋 디렉터리를 로딩하는 경로 없음.
`listPresets()`는 빌트인만 반환.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §2.4(외부 프리셋 패턴).

## Architecture Review

### Affected Scope

- `packages/agent-preset/` — 외부 프리셋 소스 로더(파일 디렉터리 스캔 + 검증), `listPresets()`가 빌트인 + 외부 병합
- 프리셋 스키마 검증(Zod 등) — 잘못된 외부 프리셋 거부
- `packages/agent-cli` — 외부 프리셋 경로 설정(settings 또는 규약 경로)

### Alternatives Considered

1. **npm 패키지로만 외부 프리셋 배포(`@scope/preset-*` 규약).**
   - Pro: 버전·배포 생태계 활용.
   - Con: 가벼운 개인 프리셋에 과함(패키지 발행 필요). Rejected(단독).
2. **파일 기반 로딩(`~/.robota/presets/*.{json,md}`) 우선, npm 패키지 로딩은 후속 옵션.**
   - Pro: 진입 장벽 낮음(파일 하나로 프리셋); 검증 레이어로 안전; 빌트인과 병합.
   - Con: 파일 파싱/검증/충돌(같은 id) 정책 필요.

### Decision

**Alternative 2.** 파일 기반 외부 프리셋 로딩을 먼저 제공한다(규약 경로 + Zod 검증 + 빌트인과 id 병합,
충돌 시 정책 명시). npm 패키지 로딩은 후속 확장으로 남긴다. 트레이드오프: 파싱/검증/충돌 정책 비용을
감수하고 낮은 진입 장벽을 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-preset(로더/검증/병합), agent-cli(경로 설정)
- [x] Sibling scan 완료 — 기존 settings/marketplace 로딩·검증 패턴(SettingsSchema, extraKnownMarketplaces) 확인 후 유사 검증 적용
- [x] 대안 최소 2개 검토 완료 — 2개 검토
- [x] 결정 근거 문서화 완료 — 파일 우선 + 검증 + 병합 정책 근거 기록

## Solution

1. 규약 경로(`~/.robota/presets/`)의 `*.json`(및 선택적으로 `*.md` frontmatter) 스캔.
2. 각 파일을 `IPreset` 스키마로 검증; 실패 시 명확한 오류로 건너뛰되 전체 실행은 계속(개별 프리셋만 무효).
3. `listPresets()`가 빌트인 + 외부를 병합; id 충돌 시 정책(외부가 빌트인을 덮어쓸지/거부할지) 명시.
4. settings로 추가 프리셋 경로 지정 허용.

## Affected Files

- `packages/agent-preset/src/load-external-presets.ts` (NEW)
- `packages/agent-preset/src/resolve-preset.ts` (병합)
- `packages/agent-preset/src/preset-schema.ts` (NEW — Zod 검증)
- `packages/agent-framework/src/config/config-types.ts` (프리셋 경로 설정, 필요 시)

## Completion Criteria

- [x] TC-01: 임시 디렉터리에 유효한 프리셋 JSON 1개 배치 후 로딩 시 `listPresets()`에 해당 id가 포함됨을 단언하는 통합 테스트 통과
- [x] TC-02: 스키마 위반 프리셋 파일은 건너뛰고(해당 id 미등록) 나머지 로딩은 계속됨을 단언하는 통합 테스트 통과
- [x] TC-03: 외부 프리셋 id가 빌트인과 충돌 시 정의된 정책(덮어쓰기 또는 거부)대로 동작함을 단언하는 통합 테스트 통과
- [x] TC-04: 외부 프리셋이 하나도 없을 때 `listPresets()`가 빌트인만 반환(무회귀)함을 단언하는 통합 테스트 통과
- [x] TC-05: `pnpm --filter @robota-sdk/agent-preset test` + `build` → exit 0

## Test Plan

Type FLOW + tags cli → 파일 로딩/검증/병합 통합 테스트(임시 디렉터리 fixture) + 빌드 스모크.

| TC-ID | Test Type              | Tool / Approach                                             | Notes    |
| ----- | ---------------------- | ----------------------------------------------------------- | -------- |
| TC-01 | FLOW (cli)             | 통합 테스트 — 임시 디렉터리 fixture + listPresets 포함 단언 |          |
| TC-02 | FLOW (cli)             | 통합 테스트 — 위반 파일 스킵 단언                           |          |
| TC-03 | RULE (unit)            | 단위 테스트 — id 충돌 정책 단언                             |          |
| TC-04 | RULE (unit)            | 단위 테스트 — 외부 없음 시 빌트인만 단언                    |          |
| TC-05 | CI pipeline smoke test | `pnpm test` + `build` exit code                             | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — 사용자 프리셋 작성:** 전제: PRESET-001~002 완료. 실행: `~/.robota/presets/my-style.json`에
  유효한 `IPreset`(id `my-style`, appendSystemPrompt 등) 작성 후 `robota --preset my-style -p "hi"` 실행.
  기대: 사용자 프리셋이 적용되어 실행됨. 정리: 작성한 파일 삭제. Evidence: 실행 출력 + 종료코드 캡처(구현 후 기록).

환경: PRESET-002 선행. fixture(임시 프리셋 파일)는 시나리오에서 사용자가 직접 생성/삭제.

## Tasks

- [x] [.agents/tasks/PRESET-007.md](../../tasks/PRESET-007.md) — task breakdown (TC-01..TC-05)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter: `---` block present, `status: draft`, `type: FLOW` (valid 11-prefix), `tags: [cli]` present — all OK.
Problem: concrete symptom (`listPresets()` returns built-in only; no loader for `~/.robota/presets/*.{json,md}`) + reproduction condition present; no TBD/TODO/vague — OK.
Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with evidence (SettingsSchema, extraKnownMarketplaces); 2 alternatives each with Pro/Con; Decision states trade-off (파싱/검증/충돌 정책 비용 vs 낮은 진입 장벽) — OK.
Completion Criteria: TC-01..TC-05 all TC-N prefixed, Command/Observable form, no banned phrases — OK.
Test Plan: section present; 5 rows (TC-01..TC-05) match 5 Completion Criteria; each row has Test Type + Tool/Approach, no TBD; no "manual" Tool rows so manual-justification N/A — OK.
Structure: Tasks section present with placeholder; Evidence Log empty before this entry; no `## Status`/`## Classification` body sections — OK.
TC-N count match confirmed: Completion Criteria 5 = Test Plan 5.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved
Prior-gate precondition: `[GATE-WRITE] — ✅ PASS | 2026-06-14` present in Evidence Log; frontmatter `status: review-ready`; file in `backlog/` folder — prior gate confirmed.
Explicit approval: orchestrator asked "8개를 GATE-APPROVAL까지 올릴까요?" and user replied "다음 진행해" — matches "진행해" approval pattern, clearly authorizes advancing the 8 PRESET specs.
Directed at this spec: PRESET-007 is one of the 8 PRESET specs covered by the approval — OK.
No post-approval changes: Architecture Review and frontmatter (type FLOW / tags [cli]) unchanged after approval — OK.
NON-COMPLIANCE triggers cleared: `.agents/tasks/PRESET-007.md` does not exist; `packages/agent-preset/` does not exist — no implementation work started before this gate ran.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-14

**Status upgrade:** approved → in-progress
Task file `.agents/tasks/PRESET-007.md` created and linked from `## Tasks`. One task per Completion
Criterion (TC-01..TC-05) plus registry/validator/loader/cli tasks. Test Plan present (≥50 chars).

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying
All tasks `[x]`. `pnpm --filter @robota-sdk/agent-preset --filter @robota-sdk/agent-cli build` → exit 0.
`pnpm --filter @robota-sdk/agent-preset --filter @robota-sdk/agent-cli test` → exit 0 (agent-preset 2
files/55 incl. 10 new external-loading cases; agent-cli 20 files/158). Existing `resolve-preset.test.ts`
(45) stays green — mutable external registry starts empty and new tests `clearExternalPresets()` for
isolation, so the exact built-in list + unknown-id message assertions are intact. `pnpm typecheck` →
exit 0. `pnpm harness:scan` → exit 0, all 25 scans. No package.json/lockfile change, no new dependency
(manual type-guard validation, not Zod).

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done
Per-TC:

- [GATE-COMPLETE: TC-01] agent-preset vitest (`load-external-presets.test.ts`) — valid preset JSON in a temp dir → `loadExternalPresetsFromDir` registers it; `listPresets()` includes its id; `loaded` contains it.
- [GATE-COMPLETE: TC-02] vitest — a schema-violating file is skipped (recorded in `errors`, absent from `listPresets()`); a valid sibling in the same dir still loads.
- [GATE-COMPLETE: TC-03] vitest — external preset with id `default` (built-in collision) → rejected (`reason: collides with built-in preset`); a single built-in `default` survives.
- [GATE-COMPLETE: TC-04] vitest — non-existent/empty dir → `loaded` empty, `listPresets()` returns exactly the built-ins (no regression).
- [GATE-COMPLETE: TC-05] agent-preset build + test exit 0; plus `validateExternalPreset` units (bogus `effort` rejected, minimal valid accepted, missing required field rejected, unknown keys dropped).
- Boundary note: the validator types untrusted JSON as `unknown` + narrowing (correct strict-TS pattern at a data boundary; same precedent as agent-framework `config-loader.ts`) — eslint emits `unknown` warnings only, no errors, all harness gates pass.
