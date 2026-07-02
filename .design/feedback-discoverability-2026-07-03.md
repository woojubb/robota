# robota 발견가능성(Discoverability) 리포트 — AI 에이전트 소비자의 오해 사후 분석

- **작성일**: 2026-07-03
- **관점**: 이 문서는 특이한 표본이다 — **AI 코딩 에이전트(Claude)가 robota를 평가·도입하면서 실제로 저지른 오해 2건**을, 에이전트 자신이 자기 세션 로그를 복기해 레포의 정보 구조에서 원인을 추적한 기록이다. "라이브러리를 사람이 아니라 에이전트가 평가하는" 시나리오의 실측 UX 데이터로 봐 주면 좋겠다.
- **대상 버전**: 3.0.0-beta.76. 동반 문서: `feedback-speech-adoption-2026-07-03.md`(기능 피드백 — 본 문서는 정보 구조만 다룬다)

---

## 1. 무엇을 오해했나

도입 검토 단계에서 나는 두 가지를 잘못 판단했고, 두 번 모두 **사용자가 정정**한 뒤에야 소스 확인으로 뒤집었다.

| #   | 오해                                                                                                                    | 실제                                                                                                                                                              | 정정 계기                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| O1  | "robota 프로바이더는 벤더 SDK 직결이라 **AI Gateway(OpenAI-호환 엔드포인트)를 경유할 수 없다**" → 도입 반대 근거로 사용 | `OpenAIProvider({ apiKey, baseURL })`로 임의의 OpenAI-호환 엔드포인트 사용 가능. 실측에서 Vercel AI Gateway 경유 + `anthropic/*` 슬러그 스트리밍·툴콜링 전부 동작 | 사용자가 "소스를 직접 봐라" 지적                                   |
| O2  | "robota는 **에이전트 CLI 제품**(코딩 어시스턴트)이고, 우리 use case(임베디드 오케스트레이션)에는 과설계"                | robota는 **조립 가능한 라이브러리 모음**이고 agent-cli는 그 라이브러리로 만든 앱 중 하나                                                                          | 사용자가 "agent-cli조차 만들어낼 수 있는 라이브러리 모음이다" 정정 |

중요한 점: 두 오해 모두 내가 게을러서가 아니라, **레포가 첫 화면에서 제시하는 정보를 성실히 읽은 결과**였다. 아래에서 그 경로를 재구성한다.

---

## 2. 에이전트가 실제로 밟은 탐색 시퀀스 (세션 로그 복기)

내가 robota를 파악할 때 실행한 명령·읽은 파일을 순서대로 복기하면, 에이전트의 라이브러리 평가 방법이 그대로 드러난다:

| 단계 | 실제 행동                                                                                                 | 얻은 것                                                                                                                                          | 판정                                                          |
| ---- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1    | `ls packages/`                                                                                            | **41개 패키지**(agent-_ 26 + dag-_ 15) — "거대 제품군" 첫인상                                                                                    | 오해 O2 강화                                                  |
| 2    | 루트/코어 README quickstart 읽기                                                                          | 모든 예제가 `AnthropicProvider({ apiKey: ANTHROPIC_API_KEY })` — "벤더 키 직결" 확신                                                             | 오해 O1 강화                                                  |
| 3    | `agent-provider/package.json` deps 확인                                                                   | `openai`/`@anthropic-ai/sdk` 직접 의존 — "게이트웨이 통합 없음" 결론                                                                             | **오해 O1 확정** (잘못된 추론이지만 표면 증거 3개가 일치했다) |
| 4    | (정정 후) `grep -rn "baseURL" packages/agent-provider/src`                                                | **gemma 프로바이더의 테스트 파일**(LM Studio, `baseURL: localhost:1234`)에서 처음 발견                                                           | 오해 O1 해소 — 단, 발견 경로가 "다른 프로바이더의 테스트"     |
| 5    | `interfaces/agent.ts` Read                                                                                | `IAgentConfig`/`IRunOptions` — 여기서부터는 정보가 정확·완전. `maxExecutionRounds`도 여기서 발견(그 전까지 개념으로 `maxToolRounds`라 잘못 추측) | 신뢰 표면                                                     |
| 6    | `robota.test.ts` Read                                                                                     | `new Robota({...})` 생성 형태를 **테스트 픽스처에서** 학습                                                                                       | 신뢰 표면 (그러나 README가 했어야 할 일)                      |
| 7    | npm 설치 스파이크 실행                                                                                    | `.d.ts` 기반으로 쓴 코드가 수정 0으로 통과                                                                                                       | 타입 = 진실 확인                                              |
| 8    | (운영 중 이상 발견 시) `execution-pipeline.ts`·`robota-lifecycle.ts`·`function-tool.ts` 등 내부 소스 Read | 강제 요약 콜, destroy rethrow, zod 검증 등 **행동 계약은 전부 소스에서만** 확인 가능했다                                                         | 동반 문서 참조                                                |

**패턴 요약**: 에이전트의 신뢰 순서는 `타입 선언(.d.ts) > 테스트 코드 > 소스 내부 > README`였고, 실제로 README만이 오해를 만들었다. 이는 에이전트 특성이 아니라 합리적 귀결이다 — README는 서사(narrative)라 낡을 수 있지만 타입과 테스트는 CI가 강제하기 때문이다.

---

## 3. 오해의 근원 — 레포의 어느 지점이 그렇게 읽히게 했나

### 3.1 O1(게이트웨이 불가)의 근원: "OpenAI-호환"이라는 핵심 능력이 gemma 구석에만 산다

`OpenAIProvider`의 `baseURL`은 사실상 **"모든 OpenAI-호환 게이트웨이/프록시/로컬 서버 지원"** 이라는 채택-결정급 능력인데, 소비자가 마주치는 표면들은 이렇게 말한다:

- 루트 README·`agent-core` README·`agent-provider` README의 quickstart **3곳 전부** 벤더 키 직결 예제뿐
- `agent-provider` README 프로바이더 표의 OpenAI 행: "GPT-4o, GPT-4, o1, o3" — **모델 벤더 프레임**. "OpenAI-compatible"은 Gemma 행에만 등장
- `content/guide/providers.md`의 안내문: "Local models (Ollama, LM Studio...): Use the **GemmaProvider** with a custom baseURL" — 호환 엔드포인트 서사가 "로컬 모델 = Gemma" 전용으로 묶여 있음
- OpenAIProvider의 `baseURL`이 문서화된 곳은 `providers.md` 옵션 표 한 줄("Custom endpoint (e.g. Azure, proxies)")뿐이고, **게이트웨이라는 단어도, 예제 코드도 없다**
- `examples/` 9개 중 `baseURL` 사용은 express 1곳(부수적)

즉 "게이트웨이 경유 가능"을 알아내는 최단 경로가 **gemma 테스트 파일 grep**이었다. 표면 증거(quickstart 3개 + deps + 프로바이더 표)는 전부 "벤더 직결"을 가리키므로, 이 오해는 재현성이 높다 — 사람이든 에이전트든 같은 결론에 도달할 것이다.

### 3.2 O2(CLI 제품)의 근원: 첫 화면이 라이브러리가 아니라 앱을 판다

- 루트 README 첫 섹션이 **"CLI — AI Coding Assistant, `npx @robota-sdk/agent-cli`"** + CLI 데모 스크린샷. 정체성 문장("A TypeScript framework...")보다 CLI 체험이 시각적으로 앞선다
- Architecture 다이어그램도 `agent-cli`가 **최상단** — 계층도가 "CLI를 만들기 위한 스택"으로 읽힘
- `packages/` 41개가 평평하게 나열: 임베딩 소비자의 최소 집합(core+provider+tools 3개)과 CLI 제품용 패키지(command/preset/transport-tui/interface-tui...)가 구분 없이 섞임
- README는 "DAG는 별도 레포로 이관"이라 쓰지만 `packages/`에 **dag-\* 15개가 그대로 존재** — 스코프 선언과 트리가 모순되어 "거대함" 인상을 배가

### 3.3 부수 발견: README 예제가 타입과 불일치 (컴파일 불가)

루트 README와 `agent-core` README의 Core quickstart는 `systemMessage`를 `defaultModel` **안에** 넣는다:

```typescript
defaultModel: {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  systemMessage: 'You are a helpful assistant.', // ← IAgentConfig.defaultModel에 이 필드 없음
},
```

`IAgentConfig`(`packages/agent-core/src/interfaces/agent.ts:78-89`)의 `defaultModel`은 `{ provider, model, temperature?, maxTokens?, topP?, effort? }`이고 `systemMessage`는 **최상위 필드**(`:96`)다. strict TS에서 이 예제는 excess property 오류로 **컴파일되지 않는다**. "README보다 타입을 믿는" 에이전트 행동은 이런 경험이 누적된 결과인데, 첫 관문 예제가 그 불신을 즉시 확증해 준다.

---

## 4. 제안 — 다음 소비자(사람과 에이전트)가 더 잘 파악하게 하려면

우선순위순. 각 제안은 2절의 실측 탐색 패턴(타입 > 테스트 > 소스 > README)에 맞춘 것이다.

### P1. 채택-결정급 능력을 **타입 선언의 JSDoc**에 넣어라 (에이전트 최우선 표면)

에이전트가 가장 먼저·가장 신뢰하며 읽는 곳이 `interfaces/*.ts`와 `.d.ts`다. `IOpenAIProviderOptions.baseURL`에 다음 한 문단이면 O1은 발생하지 않았다:

```typescript
/**
 * Custom endpoint. Any OpenAI-compatible server works: AI gateways
 * (Vercel AI Gateway, LiteLLM, OpenRouter), Azure, vLLM, Ollama, LM Studio.
 * Setting baseURL switches apiSurface to 'chat-completions' automatically.
 * Model slugs are passed through verbatim — gateway-routed non-OpenAI models
 * (e.g. 'anthropic/claude-*') are supported.
 */
baseURL?: string;
```

같은 원리로 `Robota.run`의 JSDoc에 행동 계약(동시 호출 비안전, 히스토리 자동 누적, 툴-온리 종료 시 요약 콜 발생)을 명시하면, 동반 문서에서 지적한 "소스를 읽어야만 알 수 있는 계약 4건"이 전부 타입 표면으로 올라온다. **문서 사이트는 낡아도 `.d.ts`는 배포 아티팩트라 항상 소비자 손에 있다.**

### P2. 루트에 `llms.txt` — 에이전트 소비자용 지도

이제 라이브러리 채택 평가를 에이전트가 수행하는 경우가 실재한다(이 문서가 증거다). 루트 `llms.txt`(표준: llmstxt.org) 하나로 2절의 탐색 1~4단계를 대체할 수 있다. 권장 내용:

1. **정체성 한 줄**: "라이브러리 모음이며 agent-cli는 이것으로 만든 앱" (O2 예방)
2. **최소 임베딩 집합**: `agent-core + agent-provider + agent-tools` 3개, 나머지는 선택
3. **능력 매트릭스**: OpenAI-호환 게이트웨이 지원(baseURL), 스트리밍, zod 툴 런타임 검증, 스텝 제어(`maxExecutionRounds`) — 각 항목에 소스/예제 링크
4. **행동 계약**: run 동시성, 히스토리 수명, destroy 시맨틱, 툴-온리 턴의 요약 콜
5. 정본 예제·타입 선언 파일 경로

참고: 레포의 `AGENTS.md`/`CLAUDE.md`는 **기여자용 하네스**라서 소비자-에이전트는 (다른 레포 관례에 따라) 개발 규칙 문서로 분류하고 열지 않는다. 소비자용 지도는 별도 파일이어야 한다.

### P3. 루트 README 재구성 — 정체성 먼저, 제품은 그다음

- 첫 문장을 "**robota는 에이전트를 조립하는 TypeScript 라이브러리 모음이다. `agent-cli`(AI 코딩 어시스턴트)는 이 라이브러리로 만든 레퍼런스 앱이다**"로. CLI quickstart는 그 아래로
- 패키지 표를 **계층화**: "Start here (임베딩): core / provider / tools" → "앱 조립: framework / session / plugin" → "제품·전송: cli / command / transport-\*"
- dag-\* 15개: 이관이 사실이면 트리에서 제거하거나 표에 "이관 중(robota-dag)" 명시 — 스코프 선언과 트리의 모순 해소
- quickstart 3곳 중 최소 1곳에 **게이트웨이/호환 엔드포인트 변형** 추가 (기업 환경 다수가 "벤더 키 직접 금지 + 게이트웨이 강제" 정책이다 — 우리도 그랬고, 이 변형이 없으면 그 정책의 소비자는 표면 증거만으로 탈락 판정을 내린다)
- §3.3의 컴파일 불가 예제 수정 + README 코드블록을 CI에서 타입체크(문서 예제 회귀 방지 — twoslash, typescript-docs-verifier 등)

### P4. `examples/`에 "능력 데모" 트랙 추가

현재 examples는 통합 데모(discord/slack/telegram/express/nextjs — "어디에 넣는가")다. 파악 단계에서 필요한 것은 **능력 데모("무엇을 할 수 있는가")** 였고, 나는 그 역할을 테스트 파일에서 대신 찾았다(mock 소음 포함). 4개면 충분하다:

1. `examples/capabilities/openai-compatible-gateway/` — baseURL + 비-OpenAI 슬러그
2. `examples/capabilities/decision-agent/` — 툴-온리 결정 에이전트(라우터/오케스트레이터 패턴; 결정 추출 + 요약 콜 주의점 포함)
3. `examples/capabilities/streaming/` — runStream 소비
4. `examples/capabilities/stateless-turns/` — clearHistory 기반 반복 결정(히스토리 수명 문서화 겸용)

### P5. 프로바이더 표의 프레임을 "모델 벤더"에서 "프로토콜/엔드포인트"로

"OpenAI | GPT-4o, GPT-4, o1, o3" 같은 모델 나열은 (a) 빠르게 낡고, (b) "이 벤더 전용"이라는 오독을 만든다. "OpenAI | OpenAI API + **모든 OpenAI-호환 엔드포인트**(게이트웨이·Azure·vLLM·로컬)"처럼 **접속 가능한 표면**으로 서술하면 표가 낡지 않으면서 O1류 오해를 차단한다.

---

## 5. 요약

| 발견                      | 한 줄                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 오해 O1 (게이트웨이 불가) | 핵심 능력(baseURL=OpenAI-호환)이 gemma 구석·옵션표 한 줄에만 있고, quickstart 3곳·deps·프로바이더 표가 전부 반대 증거를 제시          |
| 오해 O2 (CLI 제품)        | README가 CLI를 먼저 팔고, 41개 평면 패키지 + dag 잔존이 "거대 제품군" 인상 형성                                                       |
| 에이전트 탐색 패턴        | 타입 > 테스트 > 소스 > README 순으로 신뢰. README만이 오해를 만들었고 타입·테스트·소스는 전부 정확했다                                |
| 최고 레버리지             | **채택-결정급 능력과 행동 계약을 JSDoc(타입 표면)으로 올리기** — 배포 아티팩트라 낡지 않고, 사람(IDE 호버)과 에이전트 모두에게 닿는다 |
| 즉시 수정                 | README quickstart의 `defaultModel.systemMessage` 타입 불일치(컴파일 불가) + 문서 예제 CI 타입체크                                     |
