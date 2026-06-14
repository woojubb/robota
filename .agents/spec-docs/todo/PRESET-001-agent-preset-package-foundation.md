---
status: approved
type: DATA
tags: [typescript]
---

# PRESET-001: agent-preset 패키지 — IPreset 계약 + resolvePreset + default 프리셋

## Problem

현재 `agent-cli`는 중립적인 단일 에이전트 하나만 조립한다. 시스템 프롬프트·모델·권한·명령 모듈
오버라이드 seam은 `agent-framework`에 이미 열려 있으나(`IInteractiveSessionStandardOptions`,
`ICreateSessionOptions`), 이를 **미리 튜닝된 명명 번들로 묶어 선택**할 수 있는 계약과 레이어가 없다.
프리셋 기능 전체(PRESET-002~007)는 "프리셋 정의 → 프레임워크 옵션으로 변환"하는 공통 계약과
resolver에 의존하는데, 그 기반이 존재하지 않는다.

**재현 조건:** `rg "agent-preset" packages` → 매치 없음. `packages/agent-preset/` 디렉터리 부재.
프리셋을 표현하는 타입(`IPreset`)이나 변환 함수(`resolvePreset`)가 어느 패키지에도 없다.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §5.

## Architecture Review

### Affected Scope

- 신규 `packages/agent-preset/` — `IPreset` 계약(SSOT), `resolvePreset()`(우선순위 병합 + DEFAULT `agentName` 상수 소유), `listPresets()`, 빌트인 `default` 프리셋. **`agent-cli`는 본 백로그에서 어떤 로직도 소유하지 않는다**(껍데기 — `--preset` 파싱/전달은 PRESET-002 범위).
- `packages/agent-preset/docs/SPEC.md` (신규 — 패키지 계약)
- `packages/agent-preset/package.json` — `@robota-sdk/agent-preset`, 의존: `@robota-sdk/agent-framework`(옵션 타입)
- `.agents/project-structure.md` — 패키지 등재 + 신규 엣지(`agent-preset → agent-framework`) 기재. (`check-dependency-direction.mjs`는 package.json에서 엣지를 **동적 도출**하므로 별도 allowlist 등재 불필요 — 일방향만 지키면 자동 검증됨.)
- `.changeset/config.json` `fixed` 그룹에 `@robota-sdk/agent-preset` 추가(전 패키지 동일 버전 규칙). 신규 패키지 버전 = **현재 모노레포 버전 `3.0.0-beta.74`**(`agent-core`와 동일).
- `.agents/publish-registry.md` — publish 결정: `agent-preset`는 SDK 표면(설계 §5: SDK 사용자 직접 import)이므로 **published(beta)**, `publishConfig.access: public`.
- 재사용(중복 금지): `agent-framework`의 `TInteractiveSessionOptions` / `TPermissionMode` 등 옵션 타입 — `IPreset` 필드는 이를 재사용/확장(타입 SSOT)

### Alternatives Considered

1. **프리셋 정의를 `agent-framework` 내부 서브모듈로 둔다.**
   - Pro: 신규 패키지 없음, 의존 그래프 단순.
   - Con: 프레임워크는 중립 조립 메커니즘인데 "의견 있는(opinionated) 콘텐츠"가 섞임 — 관심사 혼합,
     rules/skills 경계 및 layered-assembly 원칙과 충돌. Rejected.
2. **신규 `agent-preset` 패키지(계약 + resolver + 빌트인 정의).**
   - Pro: 의견 있는 콘텐츠를 프레임워크 밖으로 격리; SDK 사용자도 import 가능; 계층 규칙 준수
     (`agent-preset → agent-framework` 단방향); 후속 PRESET 백로그가 단일 계약에 의존.
   - Con: 신규 패키지 1개 추가(SPEC/등재/publish 비용).
3. **계약을 `agent-interface-preset`로, 구현을 `agent-preset`로 2패키지 분리.**
   - Pro: interface-package 규칙에 가장 정석.
   - Con: v1에 패키지 2개는 과함; 단일 가족만 소비하므로 추출 이득이 아직 없음. Rejected(필요 시 후속 추출).

### Decision

**Alternative 2.** 신규 단일 패키지 `agent-preset`를 만들고 `IPreset` 계약·`resolvePreset()`·빌트인
`default` 프리셋을 담는다. `IPreset` 필드는 `agent-framework` 옵션 타입을 재사용/확장한다(중복 타입
생성 금지, 타입 SSOT). 사용자 확인 결정(신규 `agent-preset` 패키지)과 일치. 트레이드오프: 패키지 1개
추가 비용을 감수하고 프레임워크 중립성·계층 준수·재사용성을 얻는다. 계약이 다중 가족에 필요해지면
그때 `agent-interface-preset`로 추출한다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — 신규 `agent-preset`, project-structure/publish 등재, dep-direction 등재
- [x] Sibling scan 완료 — `agent-interface-transport`(계약 패키지 패턴), `agent-framework` 옵션 타입(`interactive-session-options.ts`, `create-session-types.ts`) 확인; 옵션 타입 재사용, 중복 생성 안 함
- [x] 대안 최소 2개 검토 완료 — 3개 검토
- [x] 결정 근거 문서화 완료 — Decision에 타입 SSOT + 계층 준수 근거 기록

## Solution

`packages/agent-preset/`를 신설한다.

1. **`IPreset` 계약** (설계 제안서 §5.1, EXACT): 정체성(`id`/`title`/`description`), 페르소나
   (`appendSystemPrompt`/`systemPrompt`/`agentName`), 모델/effort(`model`/
   `effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'`/`temperature`/`maxOutputTokens`), 권한 프로파일
   (`defaultPermissionMode`/`defaultTrustLevel`/`allowedTools`/`deniedTools`), 모듈 선택
   (`enabledCommandModules`/`disabledCommandModules`), 실행 능력(`enableParallelSubagents?: boolean`/
   `selfVerification?: boolean` — framework/executor seam을 켜는 메커니즘 플래그, 페르소나 텍스트 아님),
   행동(`autonomy?: 'ask-first' | 'balanced' | 'act-first'`). **`autonomy`는 표시용 메타데이터가 아니라
   권한 포스처(`defaultPermissionMode`/`defaultTrustLevel`)를 구동하는 MECHANISM 매핑이다.** 권한/옵션
   필드 타입은 `agent-framework`에서 import(`TPermissionMode` 등) — 재정의 금지.
2. **`resolvePreset(id, { cliOverrides })`**: 프리셋 id를 받아 프레임워크 옵션 부분집합
   (`TResolvedPresetOptions`)으로 변환. **우선순위 MERGE를 이 함수가 소유한다**: 명시 옵션 > CLI 오버라이드
   (`cliOverrides`) > 프리셋 값 > 프레임워크 기본값. **DEFAULT `agentName` 상수도 `agent-preset`가
   소유한다** — 이 병합·기본값 로직은 어느 것도 `agent-cli`에 두지 않는다(cli는 호출 결과를 전달만 함).
   `default`는 항등(no-op) — 오버라이드 없는 base를 그대로 반환해 무회귀를 보장.
3. **`listPresets()`**: 등록된 프리셋의 `{ id, title, description }` 목록 반환(PRESET-006 UX의 데이터원).
4. **빌트인 `default` 프리셋**: 현재 동작과 동일(오버라이드 없음).
5. **등재/버전**: SPEC.md 작성; project-structure(엣지 포함)·publish 레지스트리 등재; `.changeset/config.json`
   `fixed` 그룹에 `@robota-sdk/agent-preset` 추가; 버전 = 현재 모노레포 버전(`3.0.0-beta.74`);
   `publishConfig.access: public`(published beta).

이 백로그는 계약과 기반만 만든다. 선택 배선(PRESET-002), 페르소나 합성(003), 번들(004), 첫 의견
프리셋(005)은 후속이다.

## Affected Files

- `packages/agent-preset/package.json` (NEW)
- `packages/agent-preset/src/index.ts` (NEW — public surface)
- `packages/agent-preset/src/preset-types.ts` (NEW — `IPreset`, `TResolvedPresetOptions`)
- `packages/agent-preset/src/resolve-preset.ts` (NEW — `resolvePreset`, `listPresets`)
- `packages/agent-preset/src/presets/default.ts` (NEW — 빌트인 default)
- `packages/agent-preset/docs/SPEC.md` (NEW)
- `packages/agent-preset/tsconfig*.json`, build config (NEW — 기존 패키지 패턴 복제)
- `.agents/project-structure.md` (패키지 + 의존 방향 엣지 기재)
- `.agents/publish-registry.md` (publish 등재 — published beta)
- `.changeset/config.json` (`fixed` 그룹에 `@robota-sdk/agent-preset` 추가)

## Completion Criteria

- [ ] TC-01: `cat packages/agent-preset/package.json` → `name` 필드가 `@robota-sdk/agent-preset`
- [ ] TC-02: `rg "export (interface|type) (IPreset|TResolvedPresetOptions)" packages/agent-preset/src` → 두 export 모두 매치
- [ ] TC-03: `rg "'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'" packages/agent-preset/src` → `IPreset.effort` enum이 `xhigh`/`max`를 포함하며 매치
- [ ] TC-04: `rg "enableParallelSubagents\?: boolean" packages/agent-preset/src` 와 `rg "selfVerification\?: boolean" packages/agent-preset/src` → 두 실행 능력 필드 모두 매치
- [ ] TC-05: `resolvePreset('default', base)`가 오버라이드 없는 base와 깊은 동등(no-op)임을 단언하는 단위 테스트 통과 (`pnpm --filter @robota-sdk/agent-preset test` → exit 0)
- [ ] TC-06: `resolvePreset(id, { cliOverrides })`의 우선순위 병합이 명시 옵션 > cliOverrides > 프리셋 값 > 프레임워크 기본값 순서로 해석됨을 단언하는 단위 테스트 통과 (cliOverrides가 프리셋 값을 덮고, 명시 옵션이 cliOverrides를 덮음)
- [ ] TC-07: `listPresets()` 반환 배열에 `id === 'default'` 항목 존재함을 단언하는 단위 테스트 통과
- [ ] TC-08: `pnpm --filter @robota-sdk/agent-preset build` → exit 0, 그리고 `node scripts/harness/check-dependency-direction.mjs` → exit 0 (agent-preset의 유일 의존 엣지 = agent-framework)
- [ ] TC-09: `pnpm harness:scan` → exit 0 (신규 패키지 SPEC/등재/구조 스캔 통과)
- [ ] TC-10: `node -p "require('./packages/agent-preset/package.json').version"` 출력이 `require('./packages/agent-core/package.json').version`과 동일(모노레포 동일 버전 규칙)
- [ ] TC-11: `rg "@robota-sdk/agent-preset" .changeset/config.json` → `fixed` 그룹에 포함되어 매치
- [ ] TC-12: `node -p "require('./packages/agent-preset/package.json').publishConfig?.access"` → `public`, 그리고 `private` 필드 부재(published)

## Test Plan

Type DATA + tags typescript. 검증 = 타입/단위 테스트(vitest) + 빌드·의존방향·스캔 커맨드 스모크.

| TC-ID | Test Type              | Tool / Approach                                                        | Notes    |
| ----- | ---------------------- | ---------------------------------------------------------------------- | -------- |
| TC-01 | CI pipeline smoke test | `cat`/`rg` package.json name 단언                                      | 커맨드폼 |
| TC-02 | DATA (typescript)      | `rg` export 패턴 (IPreset, TResolvedPresetOptions)                     | 커맨드폼 |
| TC-03 | DATA (typescript)      | `rg` effort enum 패턴 (xhigh/max 포함)                                 | 커맨드폼 |
| TC-04 | DATA (typescript)      | `rg` enableParallelSubagents / selfVerification 필드 패턴              | 커맨드폼 |
| TC-05 | RULE (unit)            | vitest 단위 테스트 — default resolve no-op 깊은 동등                   |          |
| TC-06 | RULE (unit)            | vitest 단위 테스트 — resolvePreset cliOverrides 우선순위 병합          |          |
| TC-07 | RULE (unit)            | vitest 단위 테스트 — listPresets default 포함                          |          |
| TC-08 | CI pipeline smoke test | `pnpm --filter ... build` + `check-dependency-direction.mjs` exit code | 커맨드폼 |
| TC-09 | CI pipeline smoke test | `pnpm harness:scan` exit 0                                             | 커맨드폼 |
| TC-10 | CI pipeline smoke test | `node -p` 버전 비교 (agent-preset == agent-core)                       | 커맨드폼 |
| TC-11 | CI pipeline smoke test | `rg` .changeset/config.json fixed 그룹 멤버십                          | 커맨드폼 |
| TC-12 | CI pipeline smoke test | `node -p` publishConfig.access == public + private 부재                | 커맨드폼 |

## Tasks

- [ ] `.agents/tasks/PRESET-001.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: DATA` (valid 11-prefix value); `tags: [typescript]` present.
- Problem: concrete symptom (`rg "agent-preset" packages` → no match, directory absent) + reproduction condition; no TBD/TODO/vague text.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with evidence (agent-interface-transport pattern, agent-framework option files); 3 alternatives each with Pro/Con (≥2 required); Decision references trade-off (1 package cost vs framework neutrality/layer compliance/reuse).
- Completion Criteria: 12 items all TC-N prefixed (TC-01..TC-12); command/observable form; none use banned phrases ("works correctly"/"no errors"/"implemented"/"displays correctly").
- Test Plan: `## Test Plan` present; 12 rows (TC-01..TC-12) — count matches 12 TC criteria; every row has non-empty Test Type and Tool/Approach; no row uses Tool "manual" (cat/rg/vitest/pnpm/node), so manual-Notes justification N/A.
- Structure: Tasks section present with placeholder; Evidence Log present and empty before this run; no `## Status` or `## Classification` body sections.
- TC-N count match confirmed: Completion Criteria = 12, Test Plan rows = 12.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved

- Prior-gate precondition: `### [GATE-WRITE] — ✅ PASS | 2026-06-14` entry present in Evidence Log; frontmatter `status: review-ready`, file in `backlog/` — matches expected input stage.
- Explicit user approval: orchestrator asked "8개를 GATE-APPROVAL까지 올릴까요?"; user replied verbatim "다음 진행해". "진행해" is an explicit-approval phrase per skill criteria; statement authorizes advancing these PRESET specs to approved.
- Approval directed at this spec: the question targeted advancing all 8 PRESET backlogs (PRESET-001 included) through GATE-APPROVAL — directed, unambiguous, not a clarifying-question answer.
- No Architecture Review or frontmatter type/tags modified after approval.
- NON-COMPLIANCE trigger clear: no `.agents/tasks/PRESET-001.md`; no `packages/agent-preset/` directory; `rg "agent-preset" packages` → no match. No implementation started before this gate.
