---
status: approved
type: BEHAVIOR
tags: [cli]
---

# PRESET-003: 페르소나/시스템 프롬프트 합성 — append/replace 계약 + agentName 오버라이드

## Problem

프리셋의 핵심은 페르소나(시스템 프롬프트)다. 현재 시스템 프롬프트는 `buildSessionSystemPrompt`가
기본 섹션들을 합성해 만들고, `systemPrompt`(완전 대체)/`appendSystemPrompt`(덧붙임) seam이 존재하지만,
**프레임워크가 페르소나를 이 두 경로 중 무엇으로 합성하는지에 대한 명확한 계약이 없다.** 또한 에이전트
정체성 이름이 `agentName: 'robota-cli'`로 `packages/agent-cli/src/cli.ts:254`에 하드코딩되어 있어,
정체성 기본값을 cli가 소유하고 있다 — 페르소나 합성·정체성 적용은 프레임워크 관심사이고 기본값은
프리셋(`agent-preset`) 관심사인데, cli(얇은 껍데기)가 둘 다 떠안고 있다.

**재현 조건:** `rg "agentName: 'robota-cli'" packages/agent-cli/src/cli.ts` → cli.ts:254 매치(하드코딩).
프리셋 페르소나를 기본 프롬프트에 덧붙일지 대체할지 정의/검증하는 코드 경로가 없다.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §5(레이어 책임 — agent-cli는 껍데기), §5.1, §6.1(매트릭스 #7·#12·#13).

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/assembly/create-session.ts` / `create-session-runtime.ts` — 페르소나
  append vs replace 합성 규칙(이미 존재하는 `appendSystemPrompt`/`systemPromptBuilder` 경로 확정) +
  해석된 `agentName`을 세션 조립 시 적용(정체성 적용은 프레임워크 관심사)
- `packages/agent-preset` — default 프리셋이 기본 `agentName` 상수와 페르소나 값을 소유(SSOT);
  cli에서 옮겨온 정체성 기본값의 새 소유자
- `packages/agent-cli/src/cli.ts` — **하드코딩 `agentName: 'robota-cli'`(cli.ts:254) 제거만** 수행하고,
  해석된 옵션을 그대로 전달. cli는 기본값·합성 로직을 소유하지 않는다(껍데기)
- 소비: PRESET-001 `IPreset.appendSystemPrompt`/`systemPrompt`/`agentName` + default 프리셋, PRESET-002 주입 경로

### Alternatives Considered

1. **프리셋 페르소나를 항상 `systemPrompt`(완전 대체)로 적용.**
   - Pro: 페르소나가 결정적.
   - Con: AGENTS.md/CLAUDE.md/메모리/도구 설명 등 필수 기본 섹션을 잃음 — 에이전트가 기능 상실. Rejected.
2. **기본은 `appendSystemPrompt`(덧붙임), 드물게 `systemPrompt`(완전 대체) 허용.**
   - Pro: 기본 섹션 유지 + 페르소나 레이어링(Claude Agent SDK가 base preset에 append 하는 패턴과 동일);
     완전 대체는 고급 옵션으로 남김.
   - Con: 두 경로의 우선순위/순서를 명시 검증해야 함.

### Decision

**Alternative 2.** 프리셋 페르소나는 기본적으로 `appendSystemPrompt`로 덧붙여 필수 기본 섹션을 보존하고,
`systemPrompt`(완전 대체)는 명시적 고급 옵션으로 둔다. 정체성 기본값은 cli에서 빼낸다: 기본 `agentName`
상수는 `agent-preset`의 default 프리셋(또는 프레임워크 default)이 소유하고, 프레임워크가 조립 시
`preset.agentName`을 적용한다 — `agentName`은 프리셋 > 프레임워크 기본값으로 해석된다. cli는 더 이상
기본값·합성 로직을 소유하지 않고 하드코딩 라인만 제거한다. CLI `--append-system-prompt`와 프리셋 append가
모두 있으면 순서를 결정적으로 정의(기본 섹션 → 프리셋 페르소나(append) → CLI `--append-system-prompt`).
트레이드오프: 합성 순서 검증 + 기본값 소유 이전 비용을 감수하고 기본 기능 보존 + 페르소나 레이어링 +
레이어 책임 분리(cli 껍데기화)를 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-framework(합성 규칙 + agentName 적용), agent-preset(default agentName/페르소나 값), agent-cli(하드코딩 제거만)
- [x] Sibling scan 완료 — `buildSessionSystemPrompt`/`systemPromptBuilder`/`appendSystemPrompt` 기존 경로 확인 후 재사용(신규 합성기 만들지 않음)
- [x] 대안 최소 2개 검토 완료 — 2개 검토
- [x] 결정 근거 문서화 완료 — append-우선 + 기본 섹션 보존 + 기본값 소유 이전(cli→preset/framework) 근거 기록

## Solution

1. 기본 `agentName` 상수를 cli에서 빼낸다: 상수를 `agent-preset`의 default 프리셋(또는 프레임워크 default)이
   소유하고(상수는 generic, 벤더명 없음), 프레임워크가 조립 시 `preset.agentName ?? <framework default>`로
   해석해 세션에 적용한다. `cli.ts`의 `agentName: 'robota-cli'` 하드코딩 라인을 제거하고 해석된 옵션을
   그대로 전달한다(cli는 기본값을 들고 있지 않는다).
2. 프리셋 `appendSystemPrompt`를 기존 append 경로로 주입 → 최종 system message에 페르소나 텍스트 포함.
3. 프리셋 `systemPrompt`(대체)는 고급 경로로만; 지정 시 기본 페르소나 섹션 대체하되 필수 인프라 섹션
   유지 여부를 계약으로 명시.
4. 합성 순서(결정적): 기본 섹션 → 프리셋 페르소나(append) → CLI `--append-system-prompt`.

## Affected Files

- `packages/agent-framework/src/assembly/create-session.ts` — 합성 규칙 + agentName 적용
- `packages/agent-framework/src/assembly/create-session-runtime.ts` — 합성 규칙 + agentName 적용
- `packages/agent-preset` — default 프리셋의 기본 agentName 상수 + 페르소나 값(소유자)
- `packages/agent-cli/src/cli.ts` — 하드코딩 `agentName: 'robota-cli'` 제거(소유권 없음)

## Completion Criteria

- [ ] TC-01: `appendSystemPrompt`를 가진 프리셋을 프레임워크가 조립할 때 최종 system message 문자열에 해당 페르소나 텍스트가 substring으로 포함됨을 단언하는 통합 테스트 통과
- [ ] TC-02: 페르소나 append 후에도 필수 기본 섹션(예: 작업 디렉터리/도구 설명 마커)이 최종 메시지에 여전히 substring으로 존재함을 단언하는 통합 테스트 통과
- [ ] TC-03: `agentName`을 가진 프리셋 조립 시 세션의 agentName이 프리셋 값과 동일 문자열임을 단언; `agentName` 미지정 프리셋(default) 조립 시 세션의 agentName이 `agent-preset`의 default 상수와 동일 문자열임을 단언하는 통합 테스트 통과(기본값 출처가 cli가 아닌 agent-preset임)
- [ ] TC-04: 프리셋 append + CLI `--append-system-prompt` 동시 적용 시 최종 메시지에서 [기본 섹션 마커]의 인덱스 < [프리셋 페르소나 텍스트]의 인덱스 < [CLI append 텍스트]의 인덱스임을 단언하는 통합 테스트 통과
- [ ] TC-05: `rg "agentName: 'robota-cli'" packages/agent-cli/src/cli.ts` → 매치 0건(하드코딩 제거 확인)
- [ ] TC-06: `pnpm --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-preset build` + `pnpm typecheck` → exit 0

## Test Plan

Type BEHAVIOR + tags cli → 프레임워크 합성 결과(system message/agentName) 통합 단언 테스트 + 빌드·grep 스모크.

| TC-ID | Test Type              | Tool / Approach                                                  | Notes    |
| ----- | ---------------------- | ---------------------------------------------------------------- | -------- |
| TC-01 | BEHAVIOR               | 통합 테스트 — 최종 system message 페르소나 substring 단언        |          |
| TC-02 | BEHAVIOR               | 통합 테스트 — 필수 섹션 마커 잔존 substring 단언                 |          |
| TC-03 | BEHAVIOR               | 통합 테스트 — 세션 agentName(프리셋 값 + default 상수 출처) 단언 |          |
| TC-04 | BEHAVIOR               | 통합 테스트 — 최종 메시지 내 substring 인덱스 순서 단언          |          |
| TC-05 | CI pipeline smoke test | `rg` 하드코딩 부재 단언                                          | 커맨드폼 |
| TC-06 | CI pipeline smoke test | `pnpm build` + `pnpm typecheck` exit code                        | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — 페르소나 적용 가시화:** 전제: PRESET-002 배선 완료 + `appendSystemPrompt`를 가진 임시
  테스트 프리셋(또는 PRESET-005의 `autonomous-builder`). 실행: `robota --preset <id>` 로 세션 시작 후
  프리셋 페르소나가 행동에 반영되는지 확인(예: 페르소나가 지시한 어조/행동). 기대: 프리셋별로 관찰
  가능한 어조/행동 차이. 정리: 없음. Evidence: 세션 출력 캡처(구현 후 기록).

환경: PRESET-002 선행. 별도 fixture 불필요.

## Tasks

- [ ] `.agents/tasks/PRESET-003.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: BEHAVIOR` (valid 11-prefix value); `tags: [cli]` present.
- Problem: concrete symptom (`agentName: 'robota-cli'` hardcoded at cli.ts:254) + reproduction (`rg "agentName: 'robota-cli'" packages/agent-cli/src/cli.ts` → match); no TBD/TODO/vague.
- Architecture Review: all 4 checklist items `[x]`; sibling scan `[x]` with reuse evidence (buildSessionSystemPrompt/systemPromptBuilder/appendSystemPrompt); 2 alternatives each with pro/con; Decision states trade-off (composition-order verification + ownership-transfer cost vs. base-section preservation + persona layering + layer separation).
- Completion Criteria: all items TC-01..TC-06 prefixed; command/observable-behavior form; no banned phrases ("works correctly"/"no errors"/"implemented"/"displays correctly").
- Test Plan: `## Test Plan` present; 6 rows (TC-01..TC-06) match 6 Completion Criteria TC-N (count matches); each row has non-empty Test Type + Tool/Approach, no "TBD"; no "manual"-tool rows so Notes justification N/A.
- Structure: Tasks section with placeholder present; Evidence Log present (was empty before this run); no `## Status`/`## Classification` body sections.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved

- Prior-Gate Precondition: `### [GATE-WRITE] — ✅ PASS | 2026-06-14` present; frontmatter `status: review-ready` and folder `backlog/` match expected input stage.
- Explicit approval: orchestrator asked "8개를 GATE-APPROVAL까지 올릴까요?" and user replied "다음 진행해" — clear authorization to advance all 8 PRESET specs to `approved`.
- Directed at this spec: PRESET-003 is one of the 8 PRESET specs covered by the approval.
- No Architecture Review or frontmatter type/tags modified after approval (spec unchanged since GATE-WRITE).
- NON-COMPLIANCE check: no implementation started — `.agents/tasks/PRESET-003.md` absent, `packages/agent-preset/` absent.
