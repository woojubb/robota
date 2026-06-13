---
status: approved
type: BEHAVIOR
tags: [typescript]
---

# PRESET-008: effort → 모델 호출 배선 (low/med/high/xhigh/max를 provider 요청에 전달)

## Problem

`IPreset.effort`(`'low' | 'medium' | 'high' | 'xhigh' | 'max'`)는 `agent-preset`의
`resolvePreset`이 해석(resolve)하지만, 그 해석된 값이 **실제 모델 요청까지 배선되지 않는다.**
오늘날 세션/프레임워크 옵션에서 provider 요청 빌더로 per-call 전달되는 sampling 파라미터는
`temperature`뿐이다. 예: anthropic provider는 `temperature`를 요청 파라미터에 직접 넣는다
(`packages/agent-provider/src/anthropic/provider.ts:126`,
`packages/agent-provider/src/anthropic/provider.ts:198-199`), 하지만 동일한 경로에 `effort`를 넣는
코드는 존재하지 않는다.

그 결과, 설계 제안 §6.1 매트릭스 행 #3이 지목한 **Fable 5를 가장 충실하게 재현하는 단일 레버(reasoning
effort, 기본 high)** 가 무력하다(inert): 프리셋이 `effort: 'max'`를 설정해도 모델 호출은 effort 없이
나간다.

**Reproduction condition:**

1. `rg -n "effort" packages/agent-provider/src packages/agent-framework/src` — per-call 세션 옵션에서
   provider 요청 빌더로 `effort`를 전달하는 코드 경로가 없다. provider 측 `effort`는 openai의 타입 필드
   (`packages/agent-provider/src/openai/types.ts:15`)와 deepseek의 정적 생성자 옵션
   `reasoningEffort`(`packages/agent-provider/src/deepseek/provider.ts:242`)뿐이며, 둘 다 resolve된
   per-call effort에서 흘러들어오지 않는다.
2. 프리셋(또는 세션 옵션)에 `effort`를 설정한 뒤 모델 호출을 관측하면, 요청 파라미터에 effort가 부재하다 —
   설정이 모델 호출에 아무 영향을 주지 못한다.

## Architecture Review

### Affected Scope

- **`packages/agent-framework`** — resolve된 effort를 세션/모델 호출 옵션을 통해 provider chat 요청
  입력까지 thread한다. 옵션 타입 SSOT(`ICreateSessionOptions` / interactive session options)에 effort
  채널을 노출하고, 이미 존재하는 `temperature` 전달 경로와 동일한 seam을 따른다.
- **`packages/agent-provider`** — provider 요청 빌더에서 effort를 해당 provider의 native 요청 파라미터로
  매핑한다(provider/모델이 지원하는 경우). native effort 개념이 없는 provider는 graceful no-op /
  근사(approximation)로 처리하고 그 동작을 문서화한다. 기준 sibling = anthropic의 기존 temperature 전달
  경로(`packages/agent-provider/src/anthropic/provider.ts:126`, `:198-199`).
- **NOT `agent-cli`** — cli는 껍데기다. effort 해석·전달·매핑 로직을 cli에 두지 않는다(설계 제안 §5 레이어
  불변식, §7 레이어 불변식).

### Alternatives Considered

1. **effort를 per-call 옵션으로만 남겨둔다(현 상태 유지, 배선 추가 안 함).**
   - Pro: 코드 변경 없음.
   - Con: 프리셋이 effort를 설정할 수 없다(resolve 결과가 모델 호출에 닿지 못함) → §6.1 행 #3의 단일
     레버가 무력한 채로 남는다. 설계 목표 위반. Rejected.

2. **resolve된 effort를 세션 옵션 → provider 요청 파라미터까지 thread한다(기존 temperature seam 재사용).**
   - Pro: §6.1 행 #3을 충족(effort가 실제 모델 호출에 반영). 이미 검증된 temperature 전달 경로와 동일한
     seam을 따라 타입 SSOT·레이어 규칙을 지킨다. provider별 native 매핑/no-op을 격리할 수 있다.
   - Con: 옵션 타입과 provider 요청 빌더 양쪽을 건드려야 하고, provider마다 native 지원 여부가 달라
     매핑/문서화 작업이 필요하다.

3. **agent-cli에서 effort를 직접 모델 호출에 주입한다.**
   - Pro: 단일 지점 수정으로 빠름.
   - Con: cli는 껍데기여야 한다(설계 §5·§7 레이어 불변식) — 해석·전달·매핑 로직을 cli에 두는 것은 계층
     규칙 위반이며 SDK 소비자(agent-preset 직접 import)에는 effort가 닿지 않는다. Rejected.

### Decision

**Alternative 2.** resolve된 effort를 `agent-framework`의 세션/모델 호출 옵션을 통해
`agent-provider`의 요청 빌더까지 thread하고, provider는 effort를 native 파라미터로 매핑하거나(지원 시)
문서화된 no-op으로 처리한다(미지원 시). Trade-off: 옵션 타입 + 다수 provider 요청 빌더를 함께 수정하고
provider별 native 지원 차이를 매핑/문서화해야 하는 추가 작업을 감수하는 대신, 이미 검증된 temperature
seam을 재사용해 타입 SSOT·레이어 불변식을 지키고 §6.1 행 #3의 단일 레버를 실제로 활성화한다. cli에
주입하는 Alternative 3은 레이어 불변식과 SDK 소비 경로 양쪽에서 탈락한다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — `agent-framework`(옵션→세션→provider thread), `agent-provider`(effort→native 매핑/no-op); `agent-cli`는 명시적으로 범위 외(껍데기)
- [x] Sibling scan 완료 — `agent-provider`의 기존 temperature 전달 경로 확인: anthropic `provider.ts:126`/`:198-199`, openai `responses-chat.ts:159-160`/`chat-completions-chat.ts:137-138`, deepseek/qwen `provider.ts` temperature 분기; effort는 동일 per-call 경로에 부재
- [x] 대안 최소 2개 검토 완료 — 3 alternatives evaluated above
- [x] 결정 근거 문서화 완료 — Decision references the trade-off (temperature seam 재사용 vs provider별 native 매핑/문서화 비용)

## Solution

resolve된 effort를 모델 호출 옵션으로 thread한다:

1. **`agent-framework`** — 옵션 타입 SSOT에 effort 채널을 노출하고, 기존 temperature 전달과 동일한 seam을
   통해 세션 → provider chat 요청 입력으로 effort를 전달한다. 프리셋/옵션에서 effort가 미지정이면 기본값
   **`'high'`** 를 적용한다(설계 §5.1 — 기본 high).
2. **`agent-provider`** — 각 provider 요청 빌더에서 effort를 해당 provider의 native 요청 파라미터로
   매핑한다(지원 시). native effort 개념이 없는 provider는 effort를 무시하되 에러 없이 진행하고
   (graceful no-op / 근사), 그 동작을 provider 단위로 문서화한다.

provider별 native 지원 여부와 매핑/no-op 결정은 기존 temperature 분기와 동일한 위치·패턴을 따른다.

## Affected Files

- `packages/agent-framework/src/assembly/create-session-types.ts` (옵션 타입에 effort 채널 노출 — 정확한 파일/심볼은 GATE-IMPLEMENT에서 확정)
- `packages/agent-framework/src/assembly/create-session.ts` (resolve된 effort를 세션→provider 호출로 thread; 미지정 시 기본 'high')
- `packages/agent-framework/src/interactive/interactive-session-options.ts` (effort 채널 노출, 해당 시)
- `packages/agent-provider/src/anthropic/provider.ts` (effort → native 파라미터 매핑 또는 문서화된 no-op)
- `packages/agent-provider/src/openai/*` (effort → native 매핑; 기존 `effort?` 타입 재사용)
- `packages/agent-provider/src/deepseek/provider.ts` · `packages/agent-provider/src/qwen/provider.ts` (effort → native 매핑/no-op)
- 각 provider SPEC.md / 문서 (native effort 미지원 시 graceful no-op 명시)

## Completion Criteria

- [x] TC-01: resolve된 effort가 provider 요청 파라미터에 도달한다 — 세션 옵션에 `effort: 'max'`(또는 임의 값)를 설정하고 모델 호출을 수행하면, native effort를 지원하는 provider의 요청 빌더 출력에 해당 effort 값이 존재한다(unit/integration assertion).
- [x] TC-02: 프리셋/옵션에서 effort가 미지정일 때 기본값 `'high'`가 provider 요청에 적용된다(effort 미지정 입력으로 호출 → 요청 빌더 출력의 effort === `'high'` assertion).
- [x] TC-03: native effort를 지원하지 않는 provider는 effort 입력을 에러 없이 무시한다 — effort가 설정된 호출이 throw 없이 완료되고 요청 빌더 출력에 effort 파라미터가 부재하며, 해당 no-op 동작이 provider 문서/SPEC에 기술되어 있다(integration assertion + 문서 존재 `rg` 확인).
- [x] TC-04: `pnpm build` 및 `pnpm typecheck`가 변경 패키지에 대해 exit 0으로 종료한다.

## Test Plan

Type BEHAVIOR + tags `typescript` → 동작 검증은 unit/integration(요청 빌더 출력 assertion), 타입/빌드
무결성은 build smoke로 검증한다.

| TC-ID | Test Type              | Tool / Approach                                                                                        | Notes                                                         |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| TC-01 | integration test       | vitest — effort 설정 후 provider 요청 빌더 출력에 effort 값 존재 assertion (native 지원 provider)      | 기존 temperature 전달 테스트와 동일 패턴                      |
| TC-02 | unit test              | vitest — effort 미지정 입력 → 요청 빌더 출력 effort === 'high' assertion                               | 기본 high 보장                                                |
| TC-03 | integration test       | vitest — native effort 미지원 provider 호출 throw 없음 + effort 부재 assertion; `rg`로 no-op 문서 확인 | graceful no-op + 문서 존재 동시 검증                          |
| TC-04 | CI pipeline smoke test | `pnpm build` + `pnpm typecheck` → exit 0                                                               | 변경 패키지(agent-framework, agent-provider) 빌드·타입 무결성 |

## Tasks

- [ ] `.agents/tasks/PRESET-008.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

> depends_on: PRESET-001 (IPreset.effort 계약 — effort 필드와 resolvePreset 출력이 본 백로그의 입력 계약).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready

- Frontmatter: starts with `---`; `status: draft`; `type: BEHAVIOR` (valid 11-prefix value); `tags: [typescript]` present.
- Problem: concrete symptom (effort resolved but not threaded; anthropic `provider.ts:126`, `:198-199` carry temperature, no effort path) + reproduction (`rg -n "effort" ...` + observe model call); no TBD/TODO/vague.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with evidence (anthropic/openai/deepseek/qwen temperature paths); 3 Alternatives each with Pro/Con (≥2 required); Decision references trade-off (reuse temperature seam vs per-provider native mapping/doc cost).
- Completion Criteria: TC-01..TC-04 all TC-N prefixed; command/observable form; no banned phrases ("works correctly"/"no errors"/"implemented"/"displays correctly").
- Test Plan: `## Test Plan` present; 4 rows match 4 TC-N (count matches); each row has non-empty Test Type + Tool/Approach, no "TBD"; no "manual" tool rows requiring Notes justification.
- Structure: `## Tasks` placeholder present; `## Evidence Log` was empty on this first run; no `## Status`/`## Classification` body sections.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved

- Prior-gate precondition: `### [GATE-WRITE] — ✅ PASS | 2026-06-14` entry present in Evidence Log; frontmatter `status: review-ready` and folder `backlog/` match the expected input stage.
- Explicit approval: orchestrator asked "8개를 GATE-APPROVAL까지 올릴까요?" and user replied "다음 진행해" — an unambiguous statement authorizing advancement of all 8 PRESET specs (this spec included) to `approved`.
- Directed at this spec: PRESET-008 is one of the 8 PRESET specs covered by the approval; not a clarifying-question answer or approval of an unrelated item.
- No Architecture Review or frontmatter type/tags modified after approval.
- NON-COMPLIANCE trigger clear: no `.agents/tasks/PRESET-008.md` and no `packages/agent-preset/` exist — implementation has not started.
