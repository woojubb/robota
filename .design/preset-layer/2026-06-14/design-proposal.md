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

## 5. 추천 아키텍처 — 신규 `agent-preset` 레이어

`agent-framework`(중립 조립 메커니즘)와 `agent-cli`(터미널 UI/선택) 사이에 **신규 `packages/agent-preset`** 패키지를 둔다.

```
agent-core → executor/session/tools
    → agent-framework  (중립 조립 메커니즘, 옵션 타입 SSOT)
        → [신규] agent-preset  (IPreset 계약 + 빌트인 프리셋 정의 + resolvePreset)
            → agent-cli  (--preset 선택 → resolve → 기존 seam 주입)
```

- 의존 방향: `agent-preset → agent-framework`(옵션 타입 소비). `agent-cli → agent-preset`(resolver 소비). 역방향 없음 → 계층 규칙·layered-assembly 준수.
- SDK 사용자도 `agent-preset`를 직접 import 해 프리셋을 적용할 수 있다(터미널 비종속).
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

  // (3) 모델/effort
  model?: string;
  effort?: 'low' | 'medium' | 'high'; // 프레임워크/프로바이더 effort 매핑
  temperature?: number;
  maxOutputTokens?: number;

  // (4) 권한/신뢰 프로파일
  defaultPermissionMode?: TPermissionMode;
  defaultTrustLevel?: 'safe' | 'moderate' | 'full';
  allowedTools?: string[];
  deniedTools?: string[];

  // (5) 명령 모듈 선택
  enabledCommandModules?: string[]; // 화이트리스트(미지정 시 기본 전체)
  disabledCommandModules?: string[]; // 블랙리스트(deny > allow)

  // (7) 행동 가이드 — 페르소나 텍스트에 반영되는 메타데이터(문서/표시용)
  autonomy?: 'ask-first' | 'balanced' | 'act-first';
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

## 6. v1에 채택하는 generic 아키타입 (PRESET-005 및 후속)

자율성 축(ask-first ↔ act-first) × 페르소나 두께(중립 ↔ 의견) 2축을 커버:

| id                   | 스타일/행동                                          | 비고                            |
| -------------------- | ---------------------------------------------------- | ------------------------------- |
| `default`            | 현재 중립 동작                                       | 무회귀 기준선 (PRESET-001)      |
| `autonomous-builder` | 능동·철저·자기검증·고자율 (Fable 5 작업 스타일 모방) | **첫 의견 프리셋 (PRESET-005)** |
| `careful-reviewer`   | 읽기 중심, write/exec마다 ask, 근거 장황             | 후속                            |
| `neutral-executor`   | 얇은 페르소나, 지시에 충실, 최소 편집 (Hermes식)     | 후속                            |

> 식별자에 벤더명 없음. `autonomous-builder`의 description/문서에 "Fable 5 작업 스타일에서 영감" 정도의 출처 각주는 허용(사용자 확인됨: generic 식별자).

## 7. 백로그 분해 (계층적·점진적)

| ID         | 제목                                                                           | type     | 우선순위 | 선행                     |
| ---------- | ------------------------------------------------------------------------------ | -------- | -------- | ------------------------ |
| PRESET-001 | `agent-preset` 패키지 — IPreset 계약 + resolvePreset + `default` 프리셋        | DATA     | critical | —                        |
| PRESET-002 | `--preset` 선택 배선 — 플래그 + settings 기본 + buildCommandSetup 주입(무회귀) | FLOW     | high     | 001                      |
| PRESET-003 | 페르소나/시스템 프롬프트 합성 — append/replace 계약 + agentName 오버라이드     | BEHAVIOR | high     | 001                      |
| PRESET-004 | 번들 — 명령 모듈 선택 + 권한/신뢰 프로파일 per preset                          | BEHAVIOR | medium   | 002                      |
| PRESET-005 | 첫 프리셋 `autonomous-builder` (Fable 5 작업 스타일 모방)                      | BEHAVIOR | high     | 002,003 (풀 번들 시 004) |
| PRESET-006 | 프리셋 발견/관리 UX — `/preset` 명령 + 목록 + TUI 활성 표시                    | SCREEN   | medium   | 002,005                  |
| PRESET-007 | 사용자 작성/외부 프리셋 로딩(파일/npm)                                         | FLOW     | low      | 001                      |

권장 실행 순서: 001 → 002 → 003 → 004 → 005 → 006 → (007 선택).

## 8. 영향 패키지 요약

- 신규: `packages/agent-preset/` (+ SPEC.md, project-structure 등재, publish-registry 등재)
- 수정: `packages/agent-cli/src/cli.ts`(agentName 하드코딩 제거, --preset), `startup/command-setup.ts`(프리셋 주입), `utils/cli-args.ts`(--preset), `packages/agent-command/src/default/default-command-modules.ts`(조건부 선택), `packages/agent-framework`(옵션 타입 노출 — 대부분 이미 존재)
- 무회귀: `default` 프리셋이 현재 동작 재현
