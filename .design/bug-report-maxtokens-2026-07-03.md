# [Bug] maxTokens가 4개 설정 경로 중 3개에서 프로바이더 요청에 실리지 않음

- **보고일**: 2026-07-03
- **버전**: `@robota-sdk/agent-core` / `agent-provider` **3.0.0-beta.76** (npm)
- **환경**: Node 24.13, macOS, `OpenAIProvider({ apiKey, baseURL })` — Vercel AI Gateway OpenAI-호환 엔드포인트, 모델 `anthropic/claude-haiku-4.5`
- **심각도 제안**: 높음 — 응답 길이 제어는 비용·지연·UX에 직결되는 기본 옵션이고, 조용히 무시되어 소비자가 알아차리기 어렵다
- **출처**: speech 프로젝트 도입 중 실측 발견 (동반 문서: `.design/feedback-speech-adoption-2026-07-03.md`)

## 요약

`maxTokens`를 설정하는 공개 경로가 둘(`IAgentConfig.defaultModel.maxTokens`, `IRunOptions.maxTokens`)
× 실행 방식이 둘(`run()`, `runStream()`) = 4가지 조합인데, 실측 결과 **비스트리밍 `run()` +
`defaultModel` 조합만 동작**하고 나머지 3개는 조용히 무시된다. 에러도 경고도 없다.

## 실측 매트릭스

`maxTokens: 50` 지정, 프롬프트 "주4일제를 아주 길게 설명해줘"(시스템: "아주 길게 설명하는 사람입니다"), 출력 글자 수:

| 설정 경로                       | `run()`              | `runStream()` |
| ------------------------------- | -------------------- | ------------- |
| `defaultModel.maxTokens: 50`    | **66자 ✅ (절단됨)** | 2,475자 ❌    |
| `run(input, { maxTokens: 50 })` | 4,697자 ❌           | 2,489자 ❌    |

대조군(robota 미경유): 동일 게이트웨이/모델에 `max_tokens: 50`으로 직접 `POST /v1/chat/completions`
→ 63자, `finish_reason: "length"`. **엔드포인트는 정상적으로 존중하므로 드랍은 robota 내부다.**

## 재현 스크립트

```js
// npm i @robota-sdk/agent-core@3.0.0-beta.76 @robota-sdk/agent-provider@3.0.0-beta.76
import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider';

const provider = new OpenAIProvider({
  apiKey: process.env.AI_GATEWAY_API_KEY, // 임의의 OpenAI-호환 키/엔드포인트로 재현 가능
  baseURL: 'https://ai-gateway.vercel.sh/v1',
});
const mk = (extra) =>
  new Robota({
    name: 't',
    aiProviders: [provider],
    defaultModel: { provider: 'openai', model: 'anthropic/claude-haiku-4.5', ...extra },
    systemMessage: '아주 길게 설명하는 사람입니다.',
  });
const q = '주4일제를 아주 길게 설명해줘';

console.log('run+defaultModel :', (await mk({ maxTokens: 50 }).run(q)).length); // 66  ✅
console.log('run+options      :', (await mk({}).run(q, { maxTokens: 50 })).length); // 4697 ❌
let a = '';
for await (const d of mk({ maxTokens: 50 }).runStream(q)) a += d;
console.log('stream+default   :', a.length); // 2475 ❌
let b = '';
for await (const d of mk({}).runStream(q, { maxTokens: 50 })) b += d;
console.log('stream+options   :', b.length); // 2489 ❌
```

## 소스 소견 (beta.76 기준 추정 — 정확한 근인은 팀 확인 필요)

- 요청 빌더에는 배선이 **존재한다**: `packages/agent-provider/src/openai/chat-completions-chat.ts:138`
  — `...(input.chatOptions?.maxTokens !== undefined && { max_tokens: ... })`.
- 비스트리밍 경로는 `execution-service-helpers.ts:68`에서 `config.defaultModel.maxTokens`를
  `aiProviderInfo`로 옮기고, 이것이 chatOptions까지 도달하는 것으로 보인다(동작하는 유일한 조합과 일치).
- 스트리밍 경로(`abstract-ai-provider.ts:187-191`의 `payload.maxTokens` 패스스루는 존재)로는
  payload에 maxTokens가 채워지지 않는 것으로 보이며, `IRunOptions.maxTokens`는
  `robota-execution.ts`의 옵션 매핑(`resolveExecutionContext` 부근)이 `temperature`/`toolChoice`
  등과 달리 **maxTokens를 집어 올리지 않는** 지점이 의심된다.

## 제안

1. **수정**: `IRunOptions.maxTokens` → 실행 컨텍스트 → chatOptions 매핑 추가, 스트리밍 request
   payload에도 `defaultModel.maxTokens`(run 옵션이 있으면 우선) 반영.
2. **회귀 테스트**: provider mock으로 4개 조합 각각에서 `chatOptions.maxTokens`가 요청 빌더에
   도달하는지 단언하는 테스트 — 이 버그는 "배선 조각은 있으나 흐름이 끊긴" 형태라 통합 수준
   단언이 필요하다.
3. (수정 전 임시) 문서에 현재 동작하는 조합(`run()` + `defaultModel`)만 명시하거나 미지원 조합에
   경고 로그를 넣으면, 소비자가 조용한 무시를 디버깅하는 비용을 아낄 수 있다.

## 소비자 영향 사례

speech는 페르소나 발화를 "일상 대화(1~2문장)"로 제한하려 `runStream` + maxTokens를 시도했으나
무시되어(18문장 문서체 출력 지속), 어댑터 레벨에서 문장 경계 스트림 절단 가드를 자체 구현해
우회했다. 프레임워크가 길이 제어를 보장했다면 불필요했을 코드다.

---

## 해결 (2026-07-03, CORE-016)

PR #933에서 수정됨. 원인: (1) `executeStream`(runStream 경로)의 chat options가
`model`/`tools`/`responseFormat`만 전달하고 maxTokens/temperature/effort를 통째로 누락,
(2) `IRunOptions.maxTokens`/`temperature`는 어떤 실행 컨텍스트에도 스레딩되지 않는 죽은 필드.
수정: 스트리밍 경로에 defaultModel 모델 옵션 패리티 + 런 단위 오버라이드를
`IExecutionContext` 경유로 두 provider 호출 지점 모두에 전달(오버라이드 우선).
회귀 테스트가 이 리포트의 매트릭스 4조합 전부를 mock provider로 단언하며, 라이브 재현
(무제한 13,501자 vs cap 50에서 238/211자)은 `CORE-016` 백로그 evidence에 기록.

제안 3(silent-ignore 완화)은 일반화하여 후속 백로그 `CORE-017`
(`.agents/backlog/CORE-017-run-options-dead-field-audit.md`)로 등록: 동일 결함 부류로
`IRunOptions.stream`/`toolChoice`가 스레딩되지 않는 죽은 필드임을 grep으로 확인했으며,
모든 공개 run 옵션은 동작하거나 제거되어야 한다는 정책으로 전수 감사 예정.
