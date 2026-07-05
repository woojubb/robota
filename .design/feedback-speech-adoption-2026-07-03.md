# robota 도입 경험 리포트 — speech 프로젝트

- **작성일**: 2026-07-03
- **대상 버전**: `@robota-sdk/agent-core` / `agent-provider` / `agent-tools` **3.0.0-beta.76** (npm, `--save-exact` 핀)
- **도입처**: speech — 실시간 AI 음성 토론 연습 웹앱 (Zoom형 룸에서 다중 페르소나와 한국어 음성 토론)
- **작성 목적**: robota 개발 피드백. 모든 지적은 beta.76 소스 기준 `파일:라인`을 인용했고, 지연 수치는 라이브 E2E 실측값이다.

---

## 1. 도입 개요

기존의 고정 오케스트레이션(진행자 LLM 1콜로 화자 목록을 미리 확정 → 순차 실행)을 **동적 턴테이킹**으로 교체하는 데 robota를 사용했다.

- **토폴로지**: 조율 에이전트 1개(발언권 툴 `selectNextSpeaker`/`endTurn` 보유) + 페르소나별 에이전트 N개(툴 없음, 발화 스트리밍 전용)
- **루프 설계**: "어댑터-소유 루프" — 조율자는 `maxExecutionRounds: 1`로 **결정 1회만 기록하고 종료**, 애플리케이션 루프가 결정을 읽어 페르소나를 조율자 호출 사이에서 실행하고, 발화를 다음 조율자 호출 컨텍스트로 재주입
- **프로바이더**: `OpenAIProvider({ apiKey, baseURL })`로 **Vercel AI Gateway의 OpenAI-호환 엔드포인트** 경유. 페르소나 모델은 `anthropic/claude-*` 슬러그
- **결과**: 라이브 QA 통과(오프닝 TTFT 1.2~1.5s, 유저 턴 TTFT 기존 대비 +14%), 프로덕션 배선 완료

---

## 2. 좋았던 점

### 2.1 타입 선언과 실제 동작의 일치 — 스파이크가 계획 코드 그대로 통과

도입 전 4항목 go/no-go 스파이크(스트리밍 / Anthropic 슬러그 / 툴콜링 / 스텝 제어)를 돌렸는데, **`.d.ts`를 보고 미리 작성한 코드가 수정 0으로 첫 실행에 전부 통과**했다. beta 딱지가 붙어 있지만 공개 API의 시그니처 신뢰도는 안정 라이브러리 수준이었다. 이후 구현·리뷰 과정에서도 `clearHistory()`·`destroy()` 등 추가로 쓴 API가 전부 선언과 일치했다.

### 2.2 OpenAI-호환 엔드포인트 지원이 실용적

`baseURL` 지정 시 Responses API 대신 Chat Completions surface로 자동 전환하는 설계(`packages/agent-provider/src/openai/provider.ts` — `apiSurface` 분기) 덕분에 AI Gateway 경유가 설정 한 줄로 됐고, 게이트웨이가 라우팅하는 **Anthropic 모델 슬러그도 문제없이** 스트리밍·툴콜링 모두 동작했다. `client` 직접 주입 옵션(`provider.ts:59-62`)이 있는 것도 커스텀 인증(OIDC 등) 관점에서 좋은 설계다.

### 2.3 `createZodFunctionTool`의 런타임 검증이 실제로 동작

선언용이 아니라 실행 전 `zodSchema.safeParse`를 실제로 돌리고(`packages/agent-tools/src/implementations/function-tool.ts:202`) 실패 시 에러 tool-result로 모델에 반환한다. LLM이 스키마를 어겨도 애플리케이션 코드에 오염된 인자가 도달하지 않는다는 확신을 줬다.

### 2.4 `clearHistory()` 후 시스템 프롬프트 자동 재주입

조율자를 stateless로 쓰기 위해 매 결정 전 `clearHistory()`를 호출하는데, 시스템 메시지가 히스토리에 없으면 `config.systemMessage`를 매 실행 시 재주입해 주는 동작(`execution-service-helpers.ts:117-121`, CORE-010) 덕분에 "히스토리 초기화 = 지시 소실"이라는 흔한 함정이 없었다. 세심한 설계라고 느꼈다.

### 2.5 조립형 구조 자체

프로바이더/툴/에이전트가 독립 패키지로 분리되어 있고 `IAgentConfig`(name, aiProviders, defaultModel, systemMessage, tools)가 명료해서, "페르소나 = 에이전트 인스턴스, 조율자 = 툴 가진 에이전트" 매핑이 자연스러웠다. `FunctionTool`이 캐스팅 없이 `IToolWithEventService`를 구조적으로 만족하는 것도 좋았다.

---

## 3. 어려웠던 점 & 개선 제안 (우선순위순)

### 3.1 [높음] 툴-온리 턴에 대한 강제 요약 콜을 끌 수 없다

**현상**: 실행이 툴 호출로 끝나고 텍스트 응답이 없으면 `forceSummaryCall`이 **추가 프로바이더 콜을 무조건** 수행한다(`packages/agent-core/src/services/execution-pipeline.ts:97-109`). 비활성화 옵션이 없고, 루프 내부와 달리 이 경로는 `AbortSignal`도 확인하지 않는다.

**영향(실측)**: 우리의 조율자는 "결정 기록 툴 호출"이 목적의 전부라 요약 텍스트를 버린다. 이 낭비 콜 때문에 결정당 ~2.5초가 추가되어 유저 턴 TTFT가 기존 대비 **+49%**까지 회귀했다. 결정 기록 시점에 promise를 early-resolve하고 요약 콜을 백그라운드로 흘리는 우회로 +14%까지 회복했지만, 요약 콜 자체(토큰 비용 포함)는 여전히 발생한다.

**제안** (어느 하나라도 충분):

1. run 옵션 `skipForcedSummary: true`(또는 `allowToolOnlyCompletion`) — 툴-온리 종료를 유효한 완료로 인정
2. "터미널 툴" 개념 — 특정 툴이 호출되면 그 자체를 최종 응답으로 간주하고 종료
3. 최소한 `forceSummaryCall` 진입 전 `signal?.aborted` 확인 — 호출자가 결정 확보 후 abort로 낭비를 끊을 수 있게

> "에이전트를 **의사결정자**로 쓰는" 패턴(라우터, 오케스트레이터, 분류기)은 흔한 사용례라고 생각한다. 지금 구조는 이 패턴에 항상 1콜 세금을 물린다.

### 3.2 [높음] `Robota.run()`에 동시 실행 가드가 없다

**현상**: 같은 인스턴스에 대한 동시 `run()` 호출을 막거나 직렬화하는 장치가 없어, 공유 히스토리에 두 실행의 메시지가 교차 append된다(소스 확인 기준). 문서화된 계약도 찾지 못했다.

**영향**: ws 서버처럼 이벤트 드리븐 환경에서는 턴 겹침이 쉽게 발생한다. 우리는 promise-chain 뮤텍스를 직접 만들어 decide를 직렬화했다.

**제안**: (a) 인스턴스 내부에 run 큐(직렬화) 옵션을 제공하거나, (b) "Robota 인스턴스는 동시 run에 안전하지 않음 — 호출자가 직렬화할 것"을 문서에 명시. 개인적으로는 히스토리를 보유한 stateful 객체인 이상 (a)가 맞다고 본다.

### 3.3 [중간] `destroy()`가 정리 실패를 재던진다

**현상**: `destroyAgent`는 정리 중 예외를 로그 후 **rethrow**한다(`packages/agent-core/src/core/robota-lifecycle.ts:124-128`).

**영향**: fire-and-forget으로 `void agent.destroy()`를 쓰면(발화마다 일회성 페르소나 인스턴스를 만드는 우리 패턴에서 자연스러운 코드) 실패 시 unhandled rejection → Node 20+ 기본 동작으로 **프로세스 전체가 죽는다**. 코드 리뷰에서 크래시 벡터로 잡혀 `void agent.destroy().catch(() => {})`로 감쌌다.

**제안**: destroy는 best-effort(내부 로그 후 삼킴)가 관례에 맞다고 본다. rethrow를 유지한다면 JSDoc에 "실패 시 throw — fire-and-forget 금지"를 명시해 달라.

### 3.4 [중간] stateless 사용 모드의 부재 — 히스토리 누적과 컨텍스트 재전달의 이중화

**현상**: 매 run의 프롬프트에 인스턴스 히스토리 전체가 실린다. 호출자가 (우리처럼) 매 호출에 전체 컨텍스트를 재구성해 넘기는 패턴이면 히스토리는 정보량 0인 순수 중복이고, 호출당 토큰이 **제곱으로** 증가한다.

**우회**: 매 run 전 `clearHistory()` (2.4의 시스템 재주입 덕에 안전).

**제안**: config에 `retainHistory: false`(run-isolated 모드) 같은 1급 옵션. clearHistory 우회는 동작하지만, "히스토리가 자동 누적되어 매 콜에 실린다"는 사실 자체가 문서에 더 눈에 띄게 있으면 좋겠다 — 비용에 직결되는 동작이라서.

### 3.5 [낮음] 툴 executor 인자가 타입 추론되지 않음

**현상**: `TToolExecutor`의 파라미터가 `Record<string, TUniversalValue>`라, zod 검증이 타입을 런타임 보장함에도 소비 코드는 `String(args['personaId'] ?? '')` 같은 방어적 변환을 해야 한다(strict + `noUncheckedIndexedAccess` 환경).

**제안**: `createZodFunctionTool<S extends z.ZodType>(name, desc, schema: S, fn: (args: z.infer<S>) => ...)` 형태의 제네릭 추론. 런타임 검증(3.2절에서 확인한 safeParse)이 이미 있으니 타입만 통과시키면 된다.

### 3.6 [낮음] 시작 문서의 공백 — `.d.ts`와 테스트 코드로 배웠다

가장 빨리 답을 준 자료가 공식 문서가 아니라 **타입 선언과 `robota.test.ts`** 였다. 특히 다음 주제는 quickstart 예제가 있으면 도입 장벽이 크게 낮아질 것이다:

1. OpenAI-호환 게이트웨이(baseURL) 경유 사용 — 비-OpenAI 슬러그 포함
2. "결정만 하는 에이전트"(툴 호출 → 결과 추출) 패턴 — 현재는 execute 콜백 사이드채널로 꺼내야 하는데, 이게 의도된 패턴인지 문서로는 알 수 없다
3. `maxExecutionRounds` 의미론 — 이름에서 "모델/툴 라운드"임을 유추하기 어려워 처음에 `maxToolRounds`로 잘못 짐작했다
4. 동시성 계약(3.2)과 히스토리 수명(3.4)

### 3.7 [참고] `@robota-sdk/agent-testing`의 가치 제안이 불분명

어댑터 루프 테스트에 agent-testing 도입을 검토했으나, 우리 seam(자체 `AgentEngine` 인터페이스)이 robota 위에 있어 손수 만든 fake 2개(~30줄)로 충분했다. 패키지 README만으로는 "무엇을 대신해 주는지"(pty 기반?)를 판단하기 어려웠다. 어떤 계층을 테스트할 때 쓰는 도구인지 포지셔닝 문서가 있으면 좋겠다.

---

## 4. 우리가 만든 우회 패턴 — 프레임워크가 1급 지원하면 좋을 것들

robota 팀이 "이런 식으로들 쓰는구나"를 아는 것이 피드백 가치가 있을 것 같아 기록한다.

| 패턴                                                                      | 왜 필요했나                                           | 프레임워크 1급 지원 시                                         |
| ------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| **결정 기록 툴** — execute가 결정을 외부 변수에 쓰고 즉시 반환            | 툴 호출 결과를 애플리케이션이 소비(에이전트가 아니라) | 3.1의 터미널 툴 또는 "run until tool-call, return it" 스텝 API |
| **early-resolve** — 툴 발화 시점에 promise resolve, run 완주는 백그라운드 | 강제 요약 콜(3.1)의 지연 은닉                         | `skipForcedSummary`면 패턴 자체가 불필요                       |
| **promise-chain 뮤텍스**                                                  | 동시 run 히스토리 경합(3.2)                           | 내부 run 큐                                                    |
| **매 run 전 clearHistory**                                                | 컨텍스트 재전달 시 O(n²) 방지(3.4)                    | `retainHistory: false`                                         |
| **`destroy().catch(() => {})`**                                           | unhandled rejection 크래시(3.3)                       | best-effort destroy                                            |

---

## 5. 종합

**결론: 도입 성공, 재선택 의사 있음.** 공개 API의 타입 정확성(2.1), 게이트웨이 호환(2.2), 툴 런타임 검증(2.3) 덕에 스파이크→프로덕션 배선까지 하루 안에 끝났고, beta인데도 우리 사용 범위에서 회귀를 겪지 않았다.

다만 우리가 만난 4개의 실전 결함 후보(강제 요약 콜, run 동시성, destroy rethrow, 히스토리 이중화)는 전부 **문서가 아니라 소스를 읽어야만** 알 수 있었다. 기능 추가보다 이 네 가지의 계약 명문화(+가능하면 옵션화)가 다음 도입자의 경험을 가장 크게 바꿀 것이라고 생각한다. 특히 3.1(강제 요약 콜)은 "에이전트를 의사결정자로 쓰는" 모든 사용자가 밟게 될 지뢰라 최우선을 권한다.

## 부록 — 실측 데이터

| 지표                              | 값                                        | 조건                                                                 |
| --------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| 스파이크 4항목                    | 전부 첫 실행 PASS                         | AI Gateway `/v1`, `AI_GATEWAY_API_KEY`, `anthropic/claude-haiku-4.5` |
| 결정 1회 소요 (요약 콜 대기 포함) | ~5.1s                                     | `maxExecutionRounds: 1`, 툴 2개, haiku                               |
| 결정 1회 소요 (early-resolve 후)  | ~1.0s                                     | 동일 조건 — 기존 구조화-출력 1콜(0.9s)과 동등                        |
| 유저 턴 TTFT                      | 기존 9.2s → 13.7s(+49%) → **10.5s(+14%)** | 한국어 STT→조율자→페르소나 E2E, early-resolve 전/후                  |
| 스트리밍                          | `runStream()` 정상 (6+ chunks/발화)       | 게이트웨이 경유 Anthropic 슬러그                                     |

---

## 추록 (2026-07-03 오후): maxTokens가 요청에 실리지 않음 — [높음]

**현상**: `defaultModel.maxTokens`와 `run/runStream(input, { maxTokens })` **양쪽 모두** 실제
프로바이더 요청에 반영되지 않는다(beta.76 실측 — maxTokens 50 지정 후 runStream: 2,475자/2,489자
출력. 동일 게이트웨이에 `max_tokens: 50` 직접 curl: 63자에서 `finish_reason: length` 절단).

**소스 소견**: 전달 경로 조각은 존재하나(`chat-completions-chat.ts:138`의
`input.chatOptions?.maxTokens`, `execution-service-helpers.ts:68`의 `aiProviderInfo.maxTokens`)
runStream 실행 흐름에서 chatOptions까지 도달하지 못하는 것으로 보인다.

**영향**: 발화 길이 상한을 프레임워크에 맡길 수 없어, 소비자(speech)는 어댑터 레벨에서
문장 경계 스트림 절단 가드를 자체 구현했다. 응답 길이 제어는 비용·지연·UX에 직결되는
기본 옵션이라 우선 수정을 권한다. (테스트 제안: provider mock으로 chatOptions.maxTokens가
요청 빌더에 도달하는지 단언하는 회귀 테스트.)
