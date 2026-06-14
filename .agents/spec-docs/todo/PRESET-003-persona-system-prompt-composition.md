---
status: approved
type: BEHAVIOR
tags: [cli]
---

# PRESET-003: 페르소나 시스템 프롬프트 합성 — `source: 'persona'` 섹션 + priority 정렬 + agentName 소유 이전

## Problem

프리셋의 핵심은 페르소나(시스템 프롬프트)다. 프레임워크는 이미 시스템 프롬프트를 **`ISystemPromptSection`
객체 배열**로 만들고 `composeSystemPrompt`(`packages/agent-framework/src/context/system-prompt-composer.ts`)가
**호출 순서가 아니라 각 섹션의 `priority: number`로 정렬**해 합성하는 공정·보편 메커니즘을 갖고 있다. 각 섹션은
`source`(`framework`/`project-instructions`/`runtime`/`permissions`/`tool`/...)와 선언된 `priority`를 가진다
(현재 밴드: AGENTS.md=10, CLAUDE.md=20, cwd=30, project=40, language=45, permissions=50, tool=60, capabilities 상위).
그런데 이 메커니즘에는 **프리셋 페르소나를 위한 `source`가 없다** — `TSystemPromptSectionSource`에 `'persona'`가
없고, persona 섹션을 만드는 provider(`createPersonaSection`)도 없으며, `buildSystemPrompt`의 `ISystemPromptParams`에
persona 입력이 없다. 그 결과 프리셋이 페르소나를 적용하려면 전체 덮어쓰기(`systemPrompt`)나 소량
append(`appendSystemPrompt`)에 의존해야 하는데, 전자는 우리 CLI의 런타임 섹션을 파괴하고 후자는 페르소나의
정상 경로가 아니다.

또한 에이전트 정체성 기본값이 cli에 남아 있다. PRESET-002가 `agentName: resolvedPreset.agentName ?? 'robota-cli'`
형태로 프리셋 fallback을 배선했지만, 리터럴 `'robota-cli'`는 여전히 `packages/agent-cli/src/cli.ts`에 박혀 있다
(cli.ts:271). 정체성 기본값은 프리셋(`agent-preset`) 관심사이고 페르소나 합성·정체성 적용은 프레임워크
관심사인데, cli(얇은 껍데기)가 기본값 리터럴을 떠안고 있다.

**재현 조건:**

- `rg "agentName: 'robota-cli'" packages/agent-cli/src/cli.ts` → cli.ts:271 매치(리터럴 잔존).
- `rg "'persona'" packages/agent-framework/src/context/system-prompt-types.ts` → 0 매치(`TSystemPromptSectionSource`에 `'persona'` 부재).
- `rg "createPersonaSection" packages/agent-framework/src/context/system-prompt-section-providers.ts` → 0 매치(persona 섹션 provider 부재).
- `rg "persona" packages/agent-framework/src/context/system-prompt-builder.ts` → 0 매치(`ISystemPromptParams` persona 입력 부재).

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md)
§5.4(시스템 프롬프트 합성 아키텍처 — AUTHORITATIVE: 페르소나는 `source: 'persona'` + 선언된 priority를 가진
또 하나의 `ISystemPromptSection`이며 기존 `composeSystemPrompt`가 priority로 정렬한다 — 전용 슬롯·하드코딩
위치 없음), §5(레이어 책임 — agent-cli는 THIN SHELL), §5.1, §6.1(매트릭스 #7·#12·#13).

PRESET-001(IPreset 계약 + resolvePreset + default 프리셋)은 이미 DONE/머지됨. PRESET-003은 그 계약에
**`persona` 필드와 레이어 합성을 추가**한다.

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/context/system-prompt-types.ts` — `TSystemPromptSectionSource` union에
  `'persona'` 추가. 기존 `ISystemPromptSection` 형태(`id`/`title?`/`priority`/`content`/`source`)는 변경 없음.
- `packages/agent-framework/src/context/system-prompt-section-providers.ts` — `createPersonaSection(persona: string):
ISystemPromptSection` 추가. `source: 'persona'`, **선언된 priority `5`**(상단 밴드 — 정체성/성격이
  project-instructions=10보다 먼저 확립되도록), 기존 `createSection(id, title, priority, content, source)` 헬퍼 재사용.
  priority는 **선언된 값**이지 배열 위치가 아니다 — `composeSystemPrompt`가 다른 모든 섹션과 동일하게 priority로 정렬한다.
- `packages/agent-framework/src/context/system-prompt-builder.ts` — `ISystemPromptParams`에 `persona?: string` 추가 +
  `buildSystemPrompt`가 `persona`가 있으면 `createPersonaSection(persona)`를 sections 배열에 push. 위치 하드코딩
  없음 — `composeSystemPrompt`가 priority `5`로 정렬해 persona가 상단 밴드에 보편 메커니즘으로 안착한다. 런타임
  섹션 provider는 모두 그대로 유지.
- `packages/agent-framework/src/assembly/create-session.ts` / `create-session-runtime.ts`
  (`buildSessionSystemPrompt`) — 해석된 `preset.persona`를 `ISystemPromptParams.persona`로 전달하고, CLI
  `--append-system-prompt`/task-file는 기존 경로대로 합성 후 말미에 append(섹션 메커니즘과 별개의 per-run seam).
  해석된 `agentName`(`preset.agentName ?? <agent-preset default 상수>`)을 세션 조립 시 적용.
- `packages/agent-preset` — `IPreset` 계약에 `persona?: string` 추가(PRESET-001 계약 확장 — `source: 'persona'`
  섹션의 내용이 될 구조화된 성격/행동 블록). `appendSystemPrompt?`/`systemPrompt?`는 유지. default 프리셋의 기본
  `agentName` 상수(generic, 벤더명 없음)를 소유 — cli에서 옮겨온 정체성 기본값의 새 소유자. default 프리셋의
  `persona`는 빈 값(빈 persona = persona 섹션 미생성 = 무회귀).
- `packages/agent-cli/src/cli.ts` — 리터럴 `'robota-cli'` 제거(forward only). cli는 기본값·합성 로직을
  소유하지 않고 해석된 옵션을 그대로 전달(THIN SHELL).
- 소비: PRESET-001 `IPreset`(+ 신규 `persona`) + default 프리셋, PRESET-002 주입 경로.

### Alternatives Considered

1. **프리셋 페르소나를 항상 `systemPrompt`(완전 대체)로 적용.**
   - Pro: 페르소나가 결정적.
   - Con: 런타임 섹션(작업 디렉터리·AGENTS.md/CLAUDE.md·메모리·도구 설명·권한·capability·언어)을 잃음 —
     에이전트가 우리 CLI 런타임 컨텍스트를 상실. 유출 프롬프트 verbatim은 타 제품 도구 정의·`/home/claude`
     경로·제품 정체성 같은 잘못된 런타임 가정을 import. Rejected.
2. **소량 `appendSystemPrompt`로만 페르소나 추가(섹션 메커니즘 미사용).**
   - Pro: 기존 seam 재사용, 신규 코드 최소.
   - Con: 페르소나(길 수 있는 구조화 블록)와 사용자 per-run append가 동일 말미 seam을 공유 → 순서/소유 모호.
     페르소나가 모든 런타임 섹션 뒤에 붙어 "성격 먼저 확립"이라는 §5.4 의도를 priority로 표현하지 못함. Rejected.
3. **하드코딩된 persona 슬롯/특례 분기 — `buildSystemPrompt`가 persona를 합성 결과 최상단에 위치로 고정(특별 케이스).**
   - Pro: persona가 항상 맨 위.
   - Con: 위치가 코드에 박힌 특혜 슬롯이라 기존 priority 정렬 메커니즘과 별개의 두 번째 합성 규칙이 생긴다 —
     `composeSystemPrompt`가 이미 priority로 공정하게 정렬하는데 persona만 슬롯·분기로 우회하는 것은 보편성 위반.
     향후 다른 기여자(plugin 등)도 같은 특혜를 요구하게 됨. Rejected.
4. **기존 priority/source 섹션 메커니즘 재사용 — persona를 `source: 'persona'` + 선언된 priority `5`를 가진 또 하나의
   `ISystemPromptSection`으로 만들고 기존 `composeSystemPrompt`가 정렬.**
   - Pro: 전용 슬롯·특례 분기 없음. persona는 다른 모든 섹션(project-instructions=10, runtime=30~ 등)과 **동일한
     priority 정렬기**를 거치며, priority `5`가 상단 밴드 위치를 **공정·보편적으로 선언**한다(`5 < 10`이라
     project-instructions보다 먼저). 프레임워크 변경이 최소·일반적(① `'persona'` source 추가 ② provider 추가
     ③ param 있으면 섹션 push). `default`(빈 persona) → 섹션 미생성 → 프롬프트 개입 0 = 무회귀. 향후 plugin 등도
     동일 `source`+`priority`로 특혜 없이 주입 가능. §5.4 AUTHORITATIVE와 정확히 일치.
   - Con: source union·provider·param 3곳 소폭 확장 + priority 정렬 결과 검증 비용.

### Decision

**Alternative 4 (기존 priority/source 섹션 메커니즘 재사용).** 페르소나는 특례가 아니라 **또 하나의 섹션**이다.
`TSystemPromptSectionSource`에 `'persona'`를 추가하고, `createPersonaSection(persona)`가 `source: 'persona'` +
**선언된 priority `5`**(상단 밴드 — `5 < 10`이라 project-instructions=10보다 먼저 성격을 확립)를 가진
`ISystemPromptSection`을 반환한다. `buildSystemPrompt`는 `persona`가 있으면 이 섹션을 sections 배열에 push할
뿐이고, **위치는 기존 `composeSystemPrompt`가 priority로 정렬**해 결정한다 — 하드코딩된 위치도, 프리셋 전용
분기도 없다. 즉 persona는 다른 모든 섹션(project-instructions·runtime·permissions·tool·capabilities)과
**완전히 동일한 정렬기**를 거치며, **공정성/보편성**이 핵심 근거다: 어떤 섹션도 특혜 슬롯을 갖지 않고 priority
숫자만으로 타이밍을 선언한다. `default` 프리셋은 persona가 비어 있어 `createPersonaSection`이 호출되어도(또는
호출되지 않아) persona 섹션이 생성되지 않으므로 **프롬프트 개입 0, 현재 동작과 100% 동일(무회귀)**. CLI
`--append-system-prompt`/task-file는 섹션 메커니즘과 별개의 per-run seam으로 합성 후 말미에 append된다.
`systemPrompt`(완전 대체)는 고급 escape hatch로 남기되 권장하지 않는다. 정체성 기본값은 cli에서 빼낸다:
기본 `agentName` 상수(generic)는 `agent-preset`의 default 프리셋이 소유하고, 프레임워크가 조립 시
`preset.agentName ?? <agent-preset default 상수>`로 해석해 적용한다 — cli는 리터럴을 들지 않고 forward만 한다.
트레이드오프: source union·provider·param 3곳 소폭 확장 + priority 정렬 결과 검증 비용을 감수하고, 보편 메커니즘
재사용(특혜 슬롯 없음) + 런타임 보존 + priority로 선언된 공정한 순서 + 무회귀(default) + 레이어 책임 분리
(cli THIN SHELL)를 얻는다. (3 하드코딩 슬롯 대비: 별개의 두 번째 합성 규칙을 만들지 않는 점이 결정적이다.)

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-framework(system-prompt-types `'persona'` source + system-prompt-section-providers `createPersonaSection` priority 5 + system-prompt-builder param + create-session 배선), agent-preset(IPreset.persona + default agentName 상수), agent-cli(리터럴 제거 forward)
- [x] Sibling scan 완료 — `system-prompt-types`(source union)·`system-prompt-section-providers`(createXSection providers)·`system-prompt-composer`(priority 정렬)·`system-prompt-builder`·`create-session-runtime` 기존 경로 확인 후 기존 섹션 메커니즘 재사용(신규 합성기·전용 슬롯 만들지 않음)
- [x] 대안 최소 2개 검토 완료 — 4개 검토(완전 대체 / 소량 append / 하드코딩 슬롯 / 기존 priority·source 섹션 재사용)
- [x] 결정 근거 문서화 완료 — 보편 priority 정렬 메커니즘 재사용(특혜 슬롯 없음) + persona priority 5 선언 + 런타임 보존 + default 무회귀 + 기본값 소유 이전(cli→preset) 근거 기록

## Solution

1. **`'persona'` source 추가(agent-framework `system-prompt-types.ts`):** `TSystemPromptSectionSource` union에
   `'persona'`를 추가. `ISystemPromptSection` 형태는 변경 없음.
2. **`createPersonaSection` provider 추가(agent-framework `system-prompt-section-providers.ts`):**
   `createPersonaSection(persona: string): ISystemPromptSection`을 기존 `createSection` 헬퍼로 작성 —
   `source: 'persona'`, **선언된 priority `5`**(상단 밴드, `5 < 10`이라 project-instructions=10 이전). priority는
   선언된 값이지 배열 위치가 아니다.
3. **`buildSystemPrompt` param + 섹션 push(agent-framework `system-prompt-builder.ts`):** `ISystemPromptParams`에
   `persona?: string` 추가. `params.persona`가 있으면(비어있지 않으면) `createPersonaSection(params.persona)`를
   sections 배열에 push. **위치 하드코딩 없음** — 기존 `composeSystemPrompt`가 priority `5`로 정렬해 persona가
   상단 밴드에 보편 메커니즘으로 안착한다. 다른 섹션 provider는 모두 그대로.
4. **세션 배선(agent-framework `create-session*` / `buildSessionSystemPrompt`):** 해석된 `preset.persona`를
   `ISystemPromptParams.persona`로 전달. CLI `--append-system-prompt`/task-file는 기존 경로대로 합성 후 말미에
   append(섹션 메커니즘과 별개의 per-run seam). `agentName`은 `preset.agentName ?? <agent-preset default 상수>`로
   해석해 세션에 적용.
5. **IPreset 계약 확장(agent-preset):** `IPreset`에 `persona?: string` 추가 — `source: 'persona'` 섹션의 내용이 될
   구조화된 성격/행동 블록(길 수 있음). `appendSystemPrompt?`/`systemPrompt?`는 유지. 이는 PRESET-001 계약(이미
   DONE)의 확장이다. default 프리셋의 `persona`는 빈 값.
6. **default agentName 소유 이전(agent-preset):** 기본 `agentName` 상수(generic, 벤더명 없음)를 `agent-preset`의
   default 프리셋이 소유. cli는 리터럴을 들지 않는다.
7. **cli forward(agent-cli):** `cli.ts`에서 리터럴 `'robota-cli'`를 제거하고 해석된 옵션을 그대로 전달.

**콘텐츠 규칙(persona RULE — 중요):** 프리셋 `persona`에는 **이식 가능한 persona/behavior만** 넣는다
(tone·formatting, refusal 철학, evenhandedness, user wellbeing, mistake-handling, output style, proactivity).
런타임/도구/제품-정체성 섹션(도구 JSON 스키마·파일 경로·제품명·현재 날짜·knowledge cutoff·MCP 커넥터)은
**절대 persona에 넣지 않는다** — 그건 프레임워크 RUNTIME 레이어의 책임이고 환경 종속이다(§5.4). `default`
프리셋의 persona는 빈 값이며, 빈 persona = persona 섹션 미생성 = 런타임 섹션만 합성 = 무회귀.

## Affected Files

- `packages/agent-framework/src/context/system-prompt-types.ts` — `TSystemPromptSectionSource`에 `'persona'` 추가
- `packages/agent-framework/src/context/system-prompt-section-providers.ts` — `createPersonaSection(persona)` 추가(`source: 'persona'`, priority `5`)
- `packages/agent-framework/src/context/system-prompt-builder.ts` — `ISystemPromptParams.persona?: string` + persona 있으면 `createPersonaSection` push(위치는 `composeSystemPrompt`가 priority로 정렬)
- `packages/agent-framework/src/assembly/create-session.ts` — `preset.persona`를 세션 옵션→system prompt param으로 전달 + agentName 적용
- `packages/agent-framework/src/assembly/create-session-runtime.ts` (`buildSessionSystemPrompt`) — `ISystemPromptParams.persona` 배선 + CLI append 말미 seam 유지
- `packages/agent-preset/src/<types>` — `IPreset`에 `persona?: string` 추가(PRESET-001 계약 확장)
- `packages/agent-preset/src/<default>` — default 프리셋의 기본 `agentName` 상수(generic) + 빈 `persona` 소유
- `packages/agent-cli/src/cli.ts` — 리터럴 `'robota-cli'` 제거(forward only)

## Completion Criteria

- [ ] TC-01: `TSystemPromptSectionSource` union에 `'persona'` 리터럴이 포함됨을 단언하는 타입/유닛 테스트 통과 — `createPersonaSection('x')`가 `source === 'persona'`인 섹션을 반환
- [ ] TC-02: `createPersonaSection('x')` 반환 섹션의 `priority === 5`이고, 이 값이 project-instructions 밴드(10)보다 작음(`5 < 10`)을 단언하는 유닛 테스트 통과
- [ ] TC-03: `persona` 텍스트를 가진 프리셋을 프레임워크가 조립할 때 최종 합성 system message 문자열에 해당 persona 텍스트가 substring으로 포함됨을 단언하는 통합 테스트 통과
- [ ] TC-04: persona가 적용된 합성 결과에서 persona 텍스트와 런타임 base-section 마커(예: 작업 디렉터리 / 도구 설명)가 **둘 다** 최종 메시지에 substring으로 존재함을 단언하는 통합 테스트 통과
- [ ] TC-05: persona가 적용된 합성 결과에서 index(persona 텍스트) < index(project-instruction/runtime base-section 마커)임을 단언하는 통합 테스트 통과(persona priority 5 < 10이라 priority 정렬로 persona가 먼저 옴 — 위치 하드코딩이 아닌 priority 결과)
- [ ] TC-06: `persona`가 빈(또는 미지정) default 프리셋 조립 시 최종 메시지에 persona 섹션이 없고 런타임-only 합성 결과와 동일 문자열임을 단언하는 통합 테스트 통과(무회귀)
- [ ] TC-07: `agentName`을 가진 프리셋 조립 시 세션 agentName이 프리셋 값과 동일 문자열임을 단언; `agentName` 미지정 프리셋(default) 조립 시 세션 agentName이 `agent-preset`의 default 상수와 동일 문자열임을 단언하는 통합 테스트 통과(기본값 출처가 cli가 아닌 agent-preset)
- [ ] TC-08: `rg "agentName: 'robota-cli'" packages/agent-cli/src/cli.ts` → 매치 0건(리터럴 제거 확인)
- [ ] TC-09: `pnpm --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-preset build` + `pnpm typecheck` → exit 0

## Test Plan

Type BEHAVIOR + tags cli → persona 섹션 메커니즘(source/priority) 유닛 단언 + 프레임워크 합성 결과(system message/agentName) 통합 단언 + 빌드·grep 스모크.

| TC-ID | Test Type              | Tool / Approach                                                                  | Notes    |
| ----- | ---------------------- | -------------------------------------------------------------------------------- | -------- |
| TC-01 | BEHAVIOR               | 유닛 테스트 — `'persona'` source union 포함 + `createPersonaSection` source 단언 |          |
| TC-02 | BEHAVIOR               | 유닛 테스트 — `createPersonaSection().priority === 5` 및 `5 < 10` 단언           |          |
| TC-03 | BEHAVIOR               | 통합 테스트 — 최종 system message persona substring 단언                         |          |
| TC-04 | BEHAVIOR               | 통합 테스트 — persona + 런타임 base-section 마커 둘 다 substring 단언            |          |
| TC-05 | BEHAVIOR               | 통합 테스트 — index(persona) < index(project-instruction/runtime 마커) 단언      |          |
| TC-06 | BEHAVIOR               | 통합 테스트 — default(빈 persona) == 런타임-only 동일 문자열 단언(무회귀)        |          |
| TC-07 | BEHAVIOR               | 통합 테스트 — 세션 agentName(프리셋 값 + default 상수 출처) 단언                 |          |
| TC-08 | CI pipeline smoke test | `rg` 리터럴 부재 단언                                                            | 커맨드폼 |
| TC-09 | CI pipeline smoke test | `pnpm build` + `pnpm typecheck` exit code                                        | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 1 — 페르소나 섹션 적용 가시화:** 전제: PRESET-002 배선 완료 + `persona`를 가진 임시 테스트
  프리셋(또는 PRESET-005의 `autonomous-builder`). 실행: `robota --preset <id>` 로 세션 시작 후 프리셋 persona가
  행동에 반영되는지 확인(예: persona가 지시한 어조/행동). 기대: 프리셋별로 관찰 가능한 어조/행동 차이. 정리:
  없음. Evidence: 세션 출력 캡처(구현 후 기록).
- **시나리오 2 — default 무회귀:** 전제: 없음. 실행: `robota`(프리셋 미지정 = default) 와 `robota --preset default`
  를 동일 입력으로 실행. 기대: 두 실행의 system message/동작이 동일(persona 섹션 미생성, 런타임-only).
  정리: 없음. Evidence: 두 세션 출력 비교 캡처(구현 후 기록).

환경: PRESET-002 선행. 별도 fixture 불필요.

## Tasks

- [ ] `.agents/tasks/PRESET-003.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: BEHAVIOR` (valid 11-prefix); `tags: [cli]` present.
- Problem: concrete symptoms via `rg` commands with expected match counts (cli.ts:271 literal, 0-match for `'persona'`/`createPersonaSection`/persona param) + reproduction condition block ("재현 조건"); no TBD/TODO/vague.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence; 4 alternatives each with Pro/Con (≥2); Decision documents trade-off (universal priority sort reuse vs hardcoded slot, runtime preservation, default no-regression, identity ownership move cli→preset).
- Completion Criteria: TC-01…TC-09 all TC-N prefixed; command/observable form; no banned phrases ("works correctly"/"no errors"/"implemented"/"displays correctly") — `rg` returned exit 1 (0 matches).
- Test Plan: `## Test Plan` present; 9 rows (TC-01…TC-09) match 9 Completion Criteria TCs (count matches); each row has non-empty Test Type + Tool/Approach, no "TBD"; no "manual"-tool rows (CI smoke rows carry "커맨드폼" Notes) — manual-justification N/A.
- Structure: Tasks section with placeholder present; Evidence Log was present and empty; no `## Status`/`## Classification` body sections (status/type/tags in frontmatter only).

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved

- Prior-Gate Precondition: `### [GATE-WRITE] — ✅ PASS | 2026-06-14` present in Evidence Log; frontmatter `status: review-ready` and `backlog/` folder match the expected input stage for GATE-APPROVAL. Precondition satisfied.
- Explicit user approval (verbatim, current rework directed at this spec's design): (1) "이거 보고 시스템 프롬프트 제대로 프리셋에 적용하는 구조가 되어야 합니다 정확하게 아키텍쳐 설계해서 백로그 업데이트 하세요" and (2) "아키텍쳐 설계상 이런 부분이 공정하고 공평하고 보편적인 타이밍에 제대로 주입되어야 합니다". These directly authorize finalizing the persona system-prompt composition architecture (source: 'persona' + priority sort + agentName ownership move) recorded in this spec and updating the backlog — a direct, unambiguous statement directed at this spec document.
- No Architecture Review or frontmatter type/tags modified after approval: frontmatter unchanged (`type: BEHAVIOR`, `tags: [cli]`); Architecture Review section (Affected Scope / Alternatives / Decision / Checklist all 4 `[x]`) reflects the approved design.
- NON-COMPLIANCE trigger (implementation started) check: `.agents/tasks/PRESET-003.md` does NOT exist (`ls` → No such file); `## Tasks` shows "미생성 (GATE-APPROVAL 통과 후 생성)". The persona-section framework change is NOT yet implemented. No implementation work started.
