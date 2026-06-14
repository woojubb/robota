# 프리셋 레이어 설계 제안 (2026-06-14)

> 상태: 설계 제안 — 사용자가 핵심 결정 3건을 확인함(신규 `agent-preset` 패키지 · generic 아키타입 명 · 풀 번들 v1). 구현은 PRESET 백로그가 게이트 파이프라인을 통과한 뒤 진행.

## 1. 목표

현재 `agent-cli`는 중립적인 단일 에이전트 하나를 조립한다. 이를 확장해, **미리 튜닝된 여러 "개성 있는" 프리셋**을 준비하고 사용자가 실행 시 선택할 수 있게 한다. 각 프리셋은 시스템 프롬프트(페르소나)·기본 모델/effort·권한/신뢰 프로파일·명령 모듈 구성을 조금씩 다르게 묶는다. 첫 프리셋은 **Fable 5의 문서화된 작업 스타일**을 모방한다.

## 2. 리서치 종합

### 2.1 Fable 5 — 검증된 사실과 정직성 경계

- `claude-fable-5`는 실제 Anthropic 모델(2026-06-09 출시). 1M 컨텍스트, 상시 adaptive thinking, raw chain-of-thought 미반환. 자매 모델 `claude-mythos-5`(safety classifier 해제판).
- 공식 문서가 기술하는 것은 **작업 스타일**: 철저함, 능동성(proactive), 자기 검증(self-validating), 높은 자율성("Opus가 멈춰 묻는 지점에서도 계속 진행"), 병렬 서브에이전트 적극 활용, 요청 범위를 넘어서는 경향.
- **중요(정직성 경계):** Anthropic은 Fable 5의 **시스템 프롬프트나 "성격 명세"를 공개한 적이 없다.** 성격 관련 서술은 2차 출처(리뷰)이며, 일부 주장("질문에 코멘트하는 경향", "접근 차단")은 미검증이다.
- → **따라서 "Fable 5 프롬프트 복제"는 불가능하다.** 우리가 만들 수 있는 것은 _문서화된 작업 스타일_ + Anthropic의 *Claude's Character 설계 원칙*을 재현한 프리셋이다. 이 점을 PRESET-005에 명시한다.

### 2.2 Anthropic "Claude's Character" 설계 원칙 (1차 출처)

풍부한 캐릭터(호기심·정직·사려깊음·열린 태도)를 *훈련*한다 / 비아첨적 정직함(듣고 싶은 말만 하지 않음) / 규칙이 아닌 **원칙 기반** / "널리 여행한 사람" 메타포(적응적이되 아첨하지 않음) / 자기 한계에 대한 정직한 모델링. → 페르소나는 "소수의 지향 특성 + 안내 역할/메타포 + 근거 있는 원칙"으로 정의한다.

### 2.3 Hermes 스타일 (참고)

NousResearch Hermes = "neutral alignment". 페르소나를 모델에 내장하지 않고 **시스템 프롬프트에 전적으로 위임**. 최소 거부·최소 설교, 사용자/시스템 프롬프트에 충실. → "페르소나는 설정 가능한 시스템 프롬프트에 산다"의 정석 예시. `neutral-executor` 아키타입의 근거.

### 2.4 "프리셋"이 묶는 합성 요소 (업계 패턴 종합)

Custom GPT · Claude Projects · Claude Agent SDK output-styles · Roo Code custom modes · Hermes 프로파일에서 공통으로 추출:

1. **정체성** — 이름, 설명, 용도
2. **페르소나 / 시스템 프롬프트** — 행동의 핵심. base에 _append_ 또는 _replace_
3. **기본 모델 + sampling/effort** — 모델, thinking 깊이, temperature, max output
4. **도구·권한 프로파일** — allow/deny/ask, 파일 접근 범위
5. **명령/스킬/모듈 선택** — 로드/활성화할 명령 모듈
6. **(선택) 지식/컨텍스트 첨부**
7. **행동 가이드라인** — 능동성/자율성 경계, "묻기 vs 실행"
8. **출력 스타일** — 형식, 장황함, 보이스

v1 풀 번들 = (2) 페르소나 + (3) 모델/effort + (4) 권한 프로파일 + (5) 모듈 선택 + (7) 행동 가이드.

## 3. 규칙 제약

- `.agents/rules/naming-style.md` (Agent Identity): 계층 함의 명칭 금지(`main agent`/`sub-agent` 등), flat 식별자 사용.
- `feedback_no_product_names`: 코드에 벤더/제품명 금지.
- → **프리셋 식별자는 generic 아키타입 명만 사용**한다. `fable5`/`hermes` 같은 식별자 금지. 스타일은 모방하되 이름은 행동을 기술한다.

## 4. 현재 조립 구조 (실사 결과)

```
bin.ts → startCli(options: IStartCliOptions)            packages/agent-cli/src/cli.ts:50
  → buildCommandSetup(cwd, args, options, version)      packages/agent-cli/src/startup/command-setup.ts:36
      → createDefaultCommandModules(...)                packages/agent-command/src/default/default-command-modules.ts:31  (하드코딩 20개 모듈)
  → (TUI) renderApp({ provider, commandModules, agentName, ... })   packages/agent-transport/src/tui/render.tsx:85
  → (PRINT) runPrintMode(...)
      → createInteractiveSession(options)               packages/agent-framework/src/interactive/interactive-session-init.ts:63
          → createSession({ systemPrompt, appendSystemPrompt, agentName, model, commandModules, ... })   packages/agent-framework/src/assembly/create-session.ts:69
              → buildSessionSystemPrompt(...)           최종 system message
              → new SessionWithAutoCompact({ systemMessage, model, tools, agentName })
```

**핵심 발견 — 오버라이드 seam이 이미 다 열려 있다.** `IInteractiveSessionStandardOptions`(interactive-session-options.ts:32-94)와 `ICreateSessionOptions`(create-session-types.ts:42-137)가 `systemPrompt` / `appendSystemPrompt` / `agentName` / `model` / `permissionMode` / `language` / `commandModules`를 이미 받는다. 우선순위: 명시 옵션 → 기본값. CLI 플래그(`--system-prompt`, `--append-system-prompt`, `--model`)도 이미 존재.

**하드코딩 지점 2곳:**

- `agentName: 'robota-cli'` — `packages/agent-cli/src/cli.ts:254`
- 명령 모듈 목록 — `default-command-modules.ts:31-61` (조건부 선택 불가)

→ 프리셋 레이어는 **새 코어 로직이 거의 필요 없다.** "프리셋 → 기존 옵션으로 변환(resolve)"하는 얇은 레이어만 추가하면 된다.

> **하드코딩 수정의 소유권:** `agentName`/모듈 목록의 기본값·해석은 `agent-cli`가 아니라
> `agent-preset`(default 프리셋) 또는 `agent-framework`(조립)로 옮긴다. cli는 더 이상 정체성·모듈
> 기본값을 소유하지 않는다(아래 §5 레이어 책임 참조).

## 5. 추천 아키텍처 — 신규 `agent-preset` 레이어

`agent-framework`(중립 조립 메커니즘)와 `agent-cli`(터미널 껍데기) 사이에 **신규 `packages/agent-preset`** 패키지를 둔다.

```
agent-core → executor/session/tools     (실행 능력: thinking/effort, 권한, 서브에이전트/백그라운드 태스크)
    → agent-framework  (중립 조립 메커니즘, 옵션 타입 SSOT, 시스템 프롬프트 합성)
        → [신규] agent-preset  (IPreset 계약 + 빌트인 프리셋 정의 + resolvePreset + 우선순위 병합)
            → agent-cli  (껍데기: --preset 파싱 + settings 읽기 + resolvePreset 호출 결과 전달 + 활성 표시)
```

**의존 엣지(정확히) — 순수 일직선 체인이 아니다:**

- `agent-preset → agent-framework` (옵션 타입/seam 소비)
- `agent-cli → agent-preset` (resolvePreset/listPresets 소비)
- `agent-cli → agent-framework` (조립 진입점 직접 호출 — cli는 composition root)
- `agent-command → agent-preset` (PRESET-006 `/preset` 명령이 `listPresets()` 소비 — 일방향, 사이클 없음)

→ agent-cli는 agent-preset·agent-framework **둘 다**에 의존한다. agent-preset은 framework를 **감싸 재노출하지
않는다**(pass-through 재export 금지 + 비대화 방지) — agent-preset은 옵션 번들(데이터)만 산출하고, 실제
조립은 agent-cli가 framework로 한다. 역방향 엣지(framework→preset, preset→cli) 없음 → 계층 규칙 준수.
개념상 패키징 단계: framework(중립) < agent-preset(튜닝 프로파일) < agent-cli(터미널 제품).

### 레이어 책임 (중요 — agent-cli는 껍데기다)

**기능/동작원리는 절대 `agent-cli`에 구현하지 않는다.** agent-cli는 TUI 껍데기로서 오직:

1. `--preset <id>` 파싱(인자) + `settings.preset` 읽기,
2. `agent-preset.resolvePreset(id, { cliOverrides })` **호출**(해석·우선순위 병합은 agent-preset 내부),
3. 그 결과(프레임워크 옵션)를 기존 조립 진입점(composition root 배선)으로 **그대로 전달**,
4. 활성 프리셋을 화면에 **표시**(렌더링).

이외의 모든 로직은 적정 레이어가 소유한다:

| 책임                                                                                   | 소유 레이어                                        |
| -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `IPreset` 계약 · 빌트인 프리셋 정의 · `resolvePreset` · 우선순위 병합 · default 기본값 | `agent-preset`                                     |
| 시스템 프롬프트(페르소나) 합성 · agentName 적용 · 권한 모드/신뢰 적용 · 모듈 선택 적용 | `agent-framework` (조립)                           |
| thinking/effort, 권한 집행, 서브에이전트/백그라운드 태스크 실행 능력                   | `agent-core` / `agent-executor` / `agent-provider` |
| 명령 모듈 선택 로직(델타 적용)                                                         | `agent-command`                                    |
| 선택(`--preset`) · 활성 표시 · 전달                                                    | `agent-cli`(껍데기) / `agent-transport`(tui 렌더)  |

- 의존 방향: `agent-preset → agent-framework`(옵션 타입 소비). `agent-cli → agent-preset`(resolver 소비). 역방향 없음 → 계층 규칙·layered-assembly 준수.
- SDK 사용자도 `agent-preset`를 직접 import 해 프리셋을 적용할 수 있다(터미널 비종속) — 프리셋이 cli에 묶이지 않는다는 증거.
- 프레임워크는 중립을 유지하고, "의견 있는(opinionated) 콘텐츠"는 `agent-preset`에 격리된다.

### 5.1 IPreset 계약 (풀 번들)

`agent-preset`가 SSOT로 소유. 모든 필드는 프레임워크 옵션 타입을 재사용/확장(타입 SSOT 규칙). 예시 형태:

```typescript
interface IPreset {
  // (1) 정체성
  id: string; // generic 아키타입 식별자 (예: 'autonomous-builder')
  title: string; // 사람이 읽는 제목
  description: string; // 용도/스타일 요약

  // (2) 페르소나
  appendSystemPrompt?: string; // 기본 시스템 프롬프트에 덧붙임 (기본 모드)
  systemPrompt?: string; // 완전 대체 (드묾)
  agentName?: string; // 정체성 이름 (cli.ts 하드코딩 대체)

  // (3) 모델/effort (Fable 5 #1·#3 — thinking 상시성은 모델 고유, effort는 핀 가능한 메커니즘)
  model?: string; // 프리셋이 모델을 핀(예: fable 계열). always-on thinking은 모델 고유(프리셋이 만들지 못함)
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; // 기본 high; 'xhigh'='ultra' 장기작업 — 모델 호출에 전달(메커니즘)
  temperature?: number;
  maxOutputTokens?: number;

  // (4) 권한/신뢰 프로파일 (autonomy를 집행하는 실제 메커니즘)
  defaultPermissionMode?: TPermissionMode;
  defaultTrustLevel?: 'safe' | 'moderate' | 'full';
  allowedTools?: string[];
  deniedTools?: string[];

  // (5) 명령 모듈 선택
  enabledCommandModules?: string[]; // 화이트리스트(미지정 시 기본 전체)
  disabledCommandModules?: string[]; // 블랙리스트(deny > allow)

  // (6) 실행 능력 (Fable 5 #4·#5·#8 — framework/executor seam을 켜는 메커니즘, 페르소나 텍스트 아님)
  enableParallelSubagents?: boolean; // agent-runtime/서브에이전트·백그라운드 디스패치 활성(executor 능력)
  selfVerification?: boolean; // 작업 후 자기검증(가능하면 fresh-context verifier 서브에이전트) 루프(framework/executor)

  // (7) 행동 가이드 — autonomy는 라벨이 아니라 권한 포스처(defaultPermissionMode/trust)를 구동한다
  autonomy?: 'ask-first' | 'balanced' | 'act-first'; // → (4) 권한 포스처 + (2) 페르소나로 매핑(메커니즘)
}
```

`resolvePreset(id, base): TResolvedPresetOptions` — 프리셋을 프레임워크 옵션으로 변환. 변환 결과는 기존 `buildCommandSetup`/세션 옵션 seam에 주입된다.

### 5.2 우선순위 (무회귀 보장)

```
명시 옵션(IStartCliOptions/SDK) > CLI 플래그(--model 등) > 프리셋 값 > 프레임워크 기본값
```

- `default` 프리셋(neutral) = **현재 동작과 100% 동일**. 프리셋 미지정 시 `default` 적용 → 무회귀.
- CLI 플래그는 항상 프리셋을 덮어쓴다(사용자 명시 의도 우선).

### 5.3 선택 메커니즘

- `--preset <id>` CLI 플래그
- `settings.json`의 `preset` 기본값 필드(전역/프로젝트)
- `/preset` 명령(목록·전환, PRESET-006)

## 6. 프리셋은 개방형 집합 — 순정(vanilla) ↔ 튜닝 대조

**프리셋 시스템은 특정 프리셋(예: Fable 5)을 위한 게 아니라, 임의 개수의 "튜닝/비튜닝" 프로파일을 동일한
계약으로 다루는 일반 시스템이다.** `IPreset` 계약 + 레지스트리 + `resolvePreset`/`listPresets`(PRESET-001,
구현 완료)가 모든 프리셋을 균일하게 처리한다. Fable 5 프리셋은 그 위의 **한 항목**일 뿐이다.

- **`default` = 순정(vanilla) 에이전트** — 어떤 튜닝도 없는 기존 순정 동작. no-op 프리셋이라 무회귀를 보장하며,
  모든 튜닝 프리셋의 **대조군**이다. (PRESET-001에서 이미 빌트인.)
- **튜닝 프리셋** = `default`에서 시스템 프롬프트/effort/권한/모듈 등을 조금씩 다르게 묶은 프로파일. 서로 다른
  방향으로 여러 개가 공존할 수 있다.

자율성 축(ask-first ↔ act-first) × 페르소나 두께(중립 ↔ 의견) 2축으로 본 v1 빌트인 + 후속 후보(집합은 개방형):

| id                   | 튜닝 여부 | 스타일/행동                                       | 담당                            |
| -------------------- | --------- | ------------------------------------------------- | ------------------------------- |
| `default`            | **순정**  | 기존 순정 동작(튜닝 없음) — 모든 프리셋의 대조군  | **PRESET-001 (구현 완료)**      |
| `autonomous-builder` | 튜닝      | 능동·철저·자기검증·고자율 (Fable 5 작동원리 모방) | **PRESET-005 (첫 튜닝 프리셋)** |
| `careful-reviewer`   | 튜닝      | 읽기 중심, write/exec마다 ask, 근거 장황          | 후속 (PRESET-009 후보)          |
| `neutral-executor`   | 튜닝      | 얇은 페르소나, 지시에 충실, 최소 편집 (Hermes식)  | 후속 (PRESET-010 후보)          |
| (사용자 작성)        | 튜닝      | 사용자가 직접 정의한 프로파일                     | PRESET-007 (외부 로딩)          |

> 빌트인 프리셋 추가는 각각 PRESET-005와 동형의 소형 백로그(콘텐츠만)다 — 시스템(PRESET-001)은 변경 없이 N개를 수용한다.
> 식별자에 벤더명 없음. `autonomous-builder`의 description/문서에 "Fable 5 작동원리에서 영감" 정도의 출처 각주는 허용(사용자 확인됨: generic 식별자).

## 6.1 Fable 5 작동원리 → 기능 추적 매트릭스 (검증 기준)

인터넷에 공개된 Fable 5의 작동원리(공식 "Prompting Claude Fable 5" 가이드 + 모델/effort/adaptive-thinking 문서, 일부 2차 출처)를 목록화하고, 각 원리를 **CLI 제품에서 재현하는 메커니즘 / 소유 레이어 / 담당 백로그**로 추적한다. "재현 수단" 범례: (a) effort 설정, (b) 페르소나/시스템 프롬프트, (c) 권한/자율성 포스처, (d) 병렬 서브에이전트·백그라운드 디스패치, (e) 자기검증 루프, (f) 모델 고유 — 프리셋으로 재현 불가.

| #         | Fable 5 작동원리                                                                         | 재현 수단                                 | 소유 레이어 (cli 아님)                                                           | 담당 백로그                                                        | 상태                                   |
| --------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| 1         | 상시 adaptive thinking(비활성 불가)                                                      | (f)+(a) 모델 핀 + thinking 비활성 안 보냄 | agent-provider/core(호출), preset가 model 핀                                     | PRESET-001(model), 005                                             | 모델 고유 — 핀만 가능(명시)            |
| 3         | effort 다이얼(low/med/high/xhigh/max, 기본 high)                                         | (a)                                       | agent-provider/core 호출에 effort 전달; preset가 SET                             | PRESET-001(IPreset.effort), 005(high), **PRESET-008(effort 배선)** | effort 필드 보강 + 배선 백로그 신설    |
| 4         | 자기검증(작업 후 검증, fresh-context verifier가 우월)                                    | (e)+(b)                                   | agent-executor/framework(verifier 루프) + 페르소나                               | PRESET-001(selfVerification), 004(능력), 005(페르소나)             | 능력 플래그 + 페르소나로 반영          |
| 5         | 장기 자율 실행(시간/일 단위)                                                             | (c)+(b)                                   | framework/executor(async·timeout) + 권한 포스처 + 페르소나                       | PRESET-004(권한), 005(페르소나)                                    | 권한 포스처 + 페르소나로 반영          |
| 6         | 묻지 않고 실행(autonomy)                                                                 | (c)+(b)                                   | agent-framework/core 권한 집행 + 페르소나                                        | PRESET-004(defaultPermissionMode/trust), 005                       | autonomy→권한 포스처 매핑              |
| 7         | 능동성·범위 확장(과확장 억제 포함)                                                       | (b)                                       | agent-preset 페르소나(framework가 합성)                                          | PRESET-003(합성), 005(페르소나)                                    | 페르소나로 반영(양방향 지침)           |
| 8         | 병렬 서브에이전트 적극 디스패치                                                          | (d)+(b)                                   | agent-executor/subagent-runner(능력) + framework `enableAgentRuntime` + 페르소나 | PRESET-001(enableParallelSubagents), 004(활성), 005                | 실행 능력 플래그 + 페르소나로 반영     |
| 10        | 파일 기반 메모리로 성능 향상                                                             | 하네스+(b)                                | 기존 메모리 시스템(agent-command/메모리) + 페르소나                              | 기존 기능 재사용 + PRESET-005 페르소나                             | 기존 메모리 활용(신규 아님)            |
| 12        | 출력 스타일(결과 우선·작업 약어 금지)                                                    | (b)                                       | agent-preset 페르소나                                                            | PRESET-005                                                         | 페르소나로 반영                        |
| 13        | 진행 보고 시 도구결과 대조(허위보고 방지)                                                | (b)+(e)                                   | 페르소나 + (선택) 검증                                                           | PRESET-005 페르소나                                                | 페르소나로 반영                        |
| 17        | 과지시 스캐폴딩 제거(가벼운 프리셋, "추론 보여줘" 금지 → reasoning_extraction 거부 회피) | (b) 저자 지침                             | agent-preset 프리셋 저자 규칙                                                    | PRESET-005(저자 제약)                                              | 프리셋 작성 규칙으로 반영              |
| 2,9,11,16 | CoT 비공개 · 트레이닝된 도구 신뢰성 · 1M 컨텍스트/검색 · safety classifier               | (f)                                       | 모델/플랫폼 고유                                                                 | —                                                                  | **재현 불가 — 명시적으로 제외/문서화** |

핵심: 프리셋으로 재현 가능한 것은 effort(3)·자율 권한 포스처(5·6)·범위/출력/그라운딩 페르소나(7·12·13)·병렬 서브에이전트 활성(8)·자기검증 루프(4)·가벼운 프리셋 저자 규칙(17)·메모리 활용(10)이다. (1·2·9·11·16)은 **모델 고유**라 프리셋이 만들지 못한다(모델 핀만 가능) — 정직하게 제외 표기한다.

> 갭 보완: effort를 모델 호출까지 실제 전달하는 배선이 기존에 없으므로 **PRESET-008(effort→모델 호출 배선, framework/provider)**을 신설한다. 병렬 서브에이전트 활성·자기검증 능력 플래그는 PRESET-004(번들) 범위로 흡수한다.

## 7. 백로그 분해 (계층적·점진적)

| ID         | 제목                                                                           | type     | 우선순위 | 선행            |
| ---------- | ------------------------------------------------------------------------------ | -------- | -------- | --------------- |
| PRESET-001 | `agent-preset` 패키지 — IPreset 계약 + resolvePreset + `default` 프리셋        | DATA     | critical | —               |
| PRESET-002 | `--preset` 선택 배선 — 플래그 + settings 기본 + buildCommandSetup 주입(무회귀) | FLOW     | high     | 001             |
| PRESET-003 | 페르소나/시스템 프롬프트 합성 — append/replace 계약 + agentName 오버라이드     | BEHAVIOR | high     | 001             |
| PRESET-004 | 번들 — 명령 모듈 선택 + 권한/신뢰 프로파일 per preset                          | BEHAVIOR | medium   | 002             |
| PRESET-008 | effort → 모델 호출 배선 (low/med/high/xhigh/max를 provider 요청에 전달)        | BEHAVIOR | high     | 001             |
| PRESET-005 | 첫 프리셋 `autonomous-builder` (Fable 5 작동원리 모방)                         | BEHAVIOR | high     | 002,003,004,008 |
| PRESET-006 | 프리셋 발견/관리 UX — `/preset` 명령 + 목록 + TUI 활성 표시                    | SCREEN   | medium   | 002,005         |
| PRESET-007 | 사용자 작성/외부 프리셋 로딩(파일/npm)                                         | FLOW     | low      | 001             |

권장 실행 순서: 001 → 002 → 003 → 004 → 008 → 005 → 006 → (007 선택).

**레이어 불변식(모든 백로그 공통):** 기능 로직은 agent-preset/agent-framework/agent-executor/agent-core/agent-command가 소유한다. `agent-cli`는 `--preset` 파싱·`resolvePreset` 호출 결과 전달·활성 표시(껍데기)만 한다. cli에 해석·합성·권한·effort·서브에이전트 로직을 두지 않는다.

## 8. 영향 패키지 요약

- 신규: `packages/agent-preset/` (+ SPEC.md, project-structure 등재, publish-registry 등재)
- 수정: `packages/agent-cli/src/cli.ts`(agentName 하드코딩 제거, --preset), `startup/command-setup.ts`(프리셋 주입), `utils/cli-args.ts`(--preset), `packages/agent-command/src/default/default-command-modules.ts`(조건부 선택), `packages/agent-framework`(옵션 타입 노출 — 대부분 이미 존재)
- 무회귀: `default` 프리셋이 현재 동작 재현
