# [Bug/Feature] 스트리밍 실행 경로가 토큰 usage 를 노출하지 않음 (getHistory·message.usage 부재)

- **보고일**: 2026-07-05
- **버전**: `@robota-sdk/agent-core` / `agent-provider` **3.0.0-beta.76** (npm, 실측) — 소스 **beta.77** 에서도 동일 코드 경로 확인
- **환경**: Node 24.15, Linux, `OpenAIProvider({ apiKey, baseURL })` — OpenAI-호환 엔드포인트(로컬 HTTP 스텁으로 재현, 키·게이트웨이 불필요)
- **심각도 제안**: 높음 — 토큰 usage 는 비용 과금·컨텍스트 관리·관측의 기본 신호인데, **스트리밍 경로에서 조용히 사라진다**. 스트리밍이 대화형 UX 의 기본 실행 방식이라 영향 범위가 넓다.
- **출처**: speech 프로젝트 정밀 과금 도입 중 실측(동반: `.design/bug-report-maxtokens-2026-07-03.md` 와 같은 "스트리밍 경로 2급 시민" 패턴)

## 요약

`Robota.run()` / `runStream()` 완료 후 소비자가 턴의 토큰 usage 를 얻을 공개 경로가 사실상 없다.
usage 리더 3종(`readTokenUsageFromMessage`, `readTokenUsageFromMetadata`,
`collectAssistantUsageMetadata`)은 모두 대화 히스토리 메시지의 `metadata.usage` / `message.usage`
를 읽지만, **스트리밍 실행에서는 그 필드가 채워지지 않는다**. 그리고 `run()` 조차 내부적으로
스트리밍을 쓰므로(아래 3번), 비스트리밍 파싱 경로(`parseChoice(choice, response.usage)`)에 도달하지
못한다. 결과적으로 **모든 실행에서 usage 가 `undefined`** 다.

> **이것은 "usage 미지원"이 아니라 robota 자신의 usage 서브시스템이 스트리밍에서 빈 데이터로
> 먹여지는 자기모순적 결함이다.** `execution-round.ts` 는 매 라운드
> `collectAssistantUsageMetadata(assistantResponse)` 로 usage 를 수집해 커밋 메시지 metadata 에
> 부착하고(L193·L211), `assistant_message_committed` 실행 이벤트로 발행하며(L219),
> `execution-usage.ts`(ANALYTICS-001)가 세션 총 usage 를 합산한다. 즉 usage 를 message·이벤트·
> 분석까지 전파하도록 이미 배선돼 있는데, **스트리밍 `assistantResponse` 에 usage 가 실리지 않아
> 이 파이프라인 전체가 0/undefined 로 귀결**된다. 소비자용 API 결함일 뿐 아니라 robota 내장
> 분석 기능이 스트리밍 턴에서 조용히 틀린 값을 산출한다.

## 사안 분류 (정확한 스코프)

- **명백한 버그**: (3) `IRunOptions.stream: false` 가 조용히 무시됨 — 타입에 존재하고 문서화된
  옵션이 no-op. (그리고 위 요약처럼 robota 내장 usage 분석이 스트리밍에서 0 을 산출.)
- **호환성 판단이 걸린 개선**: (1) 스트리밍에 `include_usage` 를 기본 전송할지는 일부 OpenAI-호환
  서버의 미지원 가능성 때문에 옵트인/폴백 설계가 필요 — 방향은 메인테이너 재량.

## 근본 원인 (소스 확인)

1. **`stream_options: { include_usage: true }` 미전송.** `chat-completions-chat.ts` 의 스트리밍
   요청 파라미터(`stream: true`, L39/L81)에 `stream_options` 가 없다. OpenAI/OpenAI-호환 엔드포인트는
   `include_usage` 없이는 스트리밍 응답에 usage 청크를 보내지 않는다. (`grep -rn 'include_usage\|stream_options' packages/*/src` → 0건.)
2. **스트림 조립기가 final-청크 usage 를 부착하지 않음 (런타임 증명).** 본 보고의 스텁은 final SSE
   청크에 usage 를 **실제로 실어 보냈는데도**, 조립된 assistant 메시지 `metadata` 에는 `executionId`
   만 남았다(usage 없음) — 즉 `include_usage` 를 보내 엔드포인트가 usage 를 줘도 조립 단계에서
   버려진다. (`openai/streaming/`·`chat-completions-chat.ts`·`adapter.ts` 소스 grep 도 usage 처리 0건.)
3. **`IRunOptions.stream: false` 가 무시됨.** `run(input, { stream: false })` 도 엔드포인트에
   `stream: true` 로 전송된다(실측 request body). 따라서 usage 를 붙이는 비스트리밍 경로
   (`parseChoice(t, e.usage)`, `...usage && { usage: parseUsage(usage) }`)로 우회할 수도 없다.

## 실측 (로컬 OpenAI-호환 스텁, 키 불필요)

스텁이 `POST /v1/chat/completions` 에 대해 스트리밍 시 final SSE 청크에
`usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 }` 를 실어 응답:

| 실행                            | 엔드포인트가 받은 요청            | `readTokenUsageFromMessage(last)` |
| ------------------------------- | --------------------------------- | --------------------------------- |
| `runStream(input)`              | `{ stream: true }` (no usage opt) | `undefined`                       |
| `run(input)`                    | `{ stream: true }`                | `undefined`                       |
| `run(input, { stream: false })` | `{ stream: true }` (무시됨)       | `undefined`                       |

조립된 assistant 메시지: `{ role: 'assistant', content: '…', metadata: { executionId }, toolCalls: [] }`
— usage 필드 없음.

## 재현 스크립트

```js
// npm i @robota-sdk/agent-core@3.0.0-beta.76 @robota-sdk/agent-provider@3.0.0-beta.76
import http from 'node:http';
import { Robota, readTokenUsageFromMessage } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider';

const USAGE = { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const p = JSON.parse(body || '{}');
    console.log(
      'endpoint received:',
      JSON.stringify({ stream: p.stream, stream_options: p.stream_options }),
    );
    if (p.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const base = { id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm' };
      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '안녕' }, finish_reason: null }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: USAGE })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'x',
          object: 'chat.completion',
          created: 0,
          model: 'm',
          choices: [
            { index: 0, message: { role: 'assistant', content: '안녕' }, finish_reason: 'stop' },
          ],
          usage: USAGE,
        }),
      );
    }
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
const provider = new OpenAIProvider({ apiKey: 'k', baseURL });
const agent = new Robota({
  name: 't',
  aiProviders: [provider],
  defaultModel: { provider: 'openai', model: 'm' },
  systemMessage: 's',
});
let out = '';
for await (const d of agent.runStream('안녕')) out += d;
const h = agent.getHistory();
console.log('usage =>', readTokenUsageFromMessage(h[h.length - 1])); // undefined
await agent.destroy().catch(() => {});
server.close();
```

## 제안 (택1 또는 조합)

1. **스트리밍 요청에 `stream_options: { include_usage: true }` 를 기본 포함**(OpenAI-호환 surface).
   final 청크의 usage 를 `stream-assembler` 가 파싱해 조립된 assistant 메시지 `usage`/`metadata.usage`
   에 채운다 → 기존 `readTokenUsageFromMessage` 가 그대로 동작.
2. `IRunOptions.stream: false` 를 실제로 존중(무시하지 않기) — 비스트리밍 경로는 이미 usage 를
   메시지에 붙이므로(`parseChoice(choice, response.usage)`) 이것만으로도 usage 획득 경로가 열린다.
3. 또는 `run`/`runStream` 이 최종 usage 를 별도 채널(반환 메타/이벤트 콜백)로 노출.

## 호환성 노트

- OpenAI-호환 엔드포인트 중 `stream_options` 미지원 서버가 있을 수 있으니, (1)은 옵트아웃/그레이스풀
  폴백을 두는 편이 안전하다.
- 본 보고는 **중립적·보편적** 관점(임의의 OpenAI-호환 소비자)에서 작성됨. 특정 소비 앱에 종속된
  요구가 아니다.
