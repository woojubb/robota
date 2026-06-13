---
status: draft
type: BEHAVIOR
tags: [cli]
---

# PRESET-003: 페르소나/시스템 프롬프트 합성 — append/replace 계약 + agentName 오버라이드

## Problem

프리셋의 핵심은 페르소나(시스템 프롬프트)다. 현재 시스템 프롬프트는 `buildSessionSystemPrompt`가
기본 섹션들을 합성해 만들고, `systemPrompt`(완전 대체)/`appendSystemPrompt`(덧붙임) seam이 존재하지만,
**프리셋이 이 두 경로 중 무엇으로 페르소나를 주입하는지에 대한 명확한 계약이 없다.** 또한 에이전트
정체성 이름이 `agentName: 'robota-cli'`로 `packages/agent-cli/src/cli.ts:254`에 하드코딩되어 프리셋이
정체성을 바꿀 수 없다.

**재현 조건:** `rg "agentName: 'robota-cli'" packages/agent-cli/src/cli.ts` → cli.ts:254 매치(하드코딩).
프리셋 페르소나를 기본 프롬프트에 덧붙일지 대체할지 정의/검증하는 코드 경로가 없다.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §4, §5.1.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/cli.ts` — 하드코딩 `agentName` 제거, 프리셋/기본값에서 해석
- `packages/agent-framework/src/assembly/create-session.ts` / `create-session-runtime.ts` — 페르소나
  append vs replace 합성 규칙(이미 존재하는 `appendSystemPrompt`/`systemPromptBuilder` 경로 확정)
- 소비: PRESET-001 `IPreset.appendSystemPrompt`/`systemPrompt`/`agentName`, PRESET-002 주입 경로

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
`systemPrompt`(완전 대체)는 명시적 고급 옵션으로 둔다. `agentName`은 프리셋 > 기본값(`'robota-cli'`
상수)으로 해석해 하드코딩을 제거한다. CLI `--append-system-prompt`와 프리셋 append가 모두 있으면
순서를 결정적으로 정의(기본 섹션 → 프리셋 페르소나 → CLI append). 트레이드오프: 합성 순서 검증
비용을 감수하고 기본 기능 보존 + 페르소나 레이어링을 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-cli(agentName), agent-framework(합성 규칙)
- [x] Sibling scan 완료 — `buildSessionSystemPrompt`/`systemPromptBuilder`/`appendSystemPrompt` 기존 경로 확인 후 재사용(신규 합성기 만들지 않음)
- [x] 대안 최소 2개 검토 완료 — 2개 검토
- [x] 결정 근거 문서화 완료 — append-우선 + 기본 섹션 보존 근거 기록

## Solution

1. `cli.ts`의 `agentName: 'robota-cli'` 하드코딩을 제거하고 `preset.agentName ?? DEFAULT_AGENT_NAME`
   상수로 해석(상수는 generic, 벤더명 없음).
2. 프리셋 `appendSystemPrompt`를 기존 append 경로로 주입 → 최종 system message에 페르소나 텍스트 포함.
3. 프리셋 `systemPrompt`(대체)는 고급 경로로만; 지정 시 기본 페르소나 섹션 대체하되 필수 인프라 섹션
   유지 여부를 계약으로 명시.
4. 합성 순서: 기본 섹션 → 프리셋 페르소나(append) → CLI `--append-system-prompt`. 결정적.

## Affected Files

- `packages/agent-cli/src/cli.ts`
- `packages/agent-framework/src/assembly/create-session.ts`
- `packages/agent-framework/src/assembly/create-session-runtime.ts`

## Completion Criteria

- [ ] TC-01: `appendSystemPrompt`를 가진 프리셋 적용 시 최종 system message 문자열에 해당 페르소나 텍스트가 substring으로 포함됨을 단언하는 통합 테스트 통과
- [ ] TC-02: 페르소나 append 시에도 필수 기본 섹션(예: 작업 디렉터리/도구 설명 마커)이 최종 메시지에 여전히 존재함을 단언하는 통합 테스트 통과
- [ ] TC-03: `agentName`을 가진 프리셋 적용 시 세션의 agentName이 프리셋 값과 일치함을 단언하는 통합 테스트 통과; 프리셋 미지정 시 기본 상수값
- [ ] TC-04: 프리셋 append + CLI `--append-system-prompt` 동시 적용 시 최종 메시지 내 순서가 [기본 → 프리셋 → CLI]임을 단언하는 통합 테스트 통과
- [ ] TC-05: `rg "agentName: 'robota-cli'" packages/agent-cli/src/cli.ts` → 매치 없음(하드코딩 제거 확인)
- [ ] TC-06: `pnpm --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-framework build` + `pnpm typecheck` → exit 0

## Test Plan

Type BEHAVIOR + tags cli → 합성 결과(system message/agentName) 통합 단언 테스트 + 빌드·grep 스모크.

| TC-ID | Test Type              | Tool / Approach                                  | Notes    |
| ----- | ---------------------- | ------------------------------------------------ | -------- |
| TC-01 | BEHAVIOR               | 통합 테스트 — 최종 system message substring 단언 |          |
| TC-02 | BEHAVIOR               | 통합 테스트 — 필수 섹션 마커 잔존 단언           |          |
| TC-03 | BEHAVIOR               | 통합 테스트 — 세션 agentName 단언                |          |
| TC-04 | BEHAVIOR               | 통합 테스트 — append 순서 단언                   |          |
| TC-05 | CI pipeline smoke test | `rg` 하드코딩 부재 단언                          | 커맨드폼 |
| TC-06 | CI pipeline smoke test | `pnpm build` + `pnpm typecheck` exit code        | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — 페르소나 적용 가시화:** 전제: PRESET-002 배선 완료 + `appendSystemPrompt`를 가진 임시
  테스트 프리셋(또는 PRESET-005의 `autonomous-builder`). 실행: `robota --preset <id>` 로 세션 시작 후
  프리셋 페르소나가 행동에 반영되는지 확인(예: 페르소나가 지시한 어조/행동). 기대: 프리셋별로 관찰
  가능한 어조/행동 차이. 정리: 없음. Evidence: 세션 출력 캡처(구현 후 기록).

환경: PRESET-002 선행. 별도 fixture 불필요.

## Tasks

- [ ] `.agents/tasks/PRESET-003.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
