[Core API](../../) / [Exports](../modules) / ModelContextProtocol

# Interface: ModelContextProtocol

모델 컨텍스트 프로토콜(MCP)

다양한 AI 모델 제공업체와 통합하기 위한 표준화된 인터페이스

## Table of contents

### Properties

- [options](ModelContextProtocol#options)

### Methods

- [chat](ModelContextProtocol#chat)
- [chatStream](ModelContextProtocol#chatstream)
- [countTokens](ModelContextProtocol#counttokens)
- [formatFunctions](ModelContextProtocol#formatfunctions)
- [formatMessages](ModelContextProtocol#formatmessages)
- [parseResponse](ModelContextProtocol#parseresponse)
- [parseStreamingChunk](ModelContextProtocol#parsestreamingchunk)

## Properties

### options

• **options**: [`ProviderOptions`](ProviderOptions)

기본 모델 및 설정

#### Defined in

[packages/core/src/model-context-protocol.ts:20](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/model-context-protocol.ts#L20)

## Methods

### chat

▸ **chat**(`context`, `options?`): `Promise`\<[`ModelResponse`](ModelResponse)\>

주어진 컨텍스트로 모델에 요청을 보내고 응답을 받습니다.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `context` | [`Context`](Context) | 요청 컨텍스트 (메시지, 함수 정의 등) |
| `options?` | `Object` | 추가 옵션 |
| `options.forcedArguments?` | `Record`\<`string`, `any`\> | - |
| `options.forcedFunction?` | `string` | - |
| `options.functionCallMode?` | ``"auto"`` \| ``"force"`` \| ``"disabled"`` | - |
| `options.maxTokens?` | `number` | - |
| `options.temperature?` | `number` | - |

#### Returns

`Promise`\<[`ModelResponse`](ModelResponse)\>

모델 응답

#### Defined in

[packages/core/src/model-context-protocol.ts:29](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/model-context-protocol.ts#L29)

___

### chatStream

▸ **chatStream**(`context`, `options?`): `AsyncIterable`\<[`StreamingResponseChunk`](StreamingResponseChunk), `any`, `any`\>

주어진 컨텍스트로 모델에 스트리밍 요청을 보내고 응답 청크를 받습니다.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `context` | [`Context`](Context) | 요청 컨텍스트 (메시지, 함수 정의 등) |
| `options?` | `Object` | 추가 옵션 |
| `options.forcedArguments?` | `Record`\<`string`, `any`\> | - |
| `options.forcedFunction?` | `string` | - |
| `options.functionCallMode?` | ``"auto"`` \| ``"force"`` \| ``"disabled"`` | - |
| `options.maxTokens?` | `number` | - |
| `options.temperature?` | `number` | - |

#### Returns

`AsyncIterable`\<[`StreamingResponseChunk`](StreamingResponseChunk), `any`, `any`\>

스트리밍 응답 AsyncIterable

#### Defined in

[packages/core/src/model-context-protocol.ts:44](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/model-context-protocol.ts#L44)

___

### countTokens

▸ **countTokens**(`input`): `Promise`\<`number`\>

모델의 토큰 사용량을 계산합니다.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `input` | `string` | 입력 텍스트 |

#### Returns

`Promise`\<`number`\>

추정 토큰 수

#### Defined in

[packages/core/src/model-context-protocol.ts:90](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/model-context-protocol.ts#L90)

___

### formatFunctions

▸ **formatFunctions**(`functions`): `any`

함수 정의를 모델이 이해할 수 있는 형식으로 포맷합니다.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `functions` | [`FunctionSchema`](FunctionSchema)[] | 함수 정의 배열 |

#### Returns

`any`

포맷된 함수 정의

#### Defined in

[packages/core/src/model-context-protocol.ts:66](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/model-context-protocol.ts#L66)

___

### formatMessages

▸ **formatMessages**(`messages`): `any`

메시지를 모델이 이해할 수 있는 형식으로 포맷합니다.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `messages` | [`Message`](Message)[] | 메시지 배열 |

#### Returns

`any`

포맷된 메시지

#### Defined in

[packages/core/src/model-context-protocol.ts:58](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/model-context-protocol.ts#L58)

___

### parseResponse

▸ **parseResponse**(`response`): [`ModelResponse`](ModelResponse)

모델 응답을 표준 형식으로 파싱합니다.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `response` | `any` | 모델의 원시 응답 |

#### Returns

[`ModelResponse`](ModelResponse)

표준화된 ModelResponse

#### Defined in

[packages/core/src/model-context-protocol.ts:74](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/model-context-protocol.ts#L74)

___

### parseStreamingChunk

▸ **parseStreamingChunk**(`chunk`): [`StreamingResponseChunk`](StreamingResponseChunk)

스트리밍 응답 청크를 표준 형식으로 파싱합니다.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `chunk` | `any` | 모델의 원시 응답 청크 |

#### Returns

[`StreamingResponseChunk`](StreamingResponseChunk)

표준화된 StreamingResponseChunk

#### Defined in

[packages/core/src/model-context-protocol.ts:82](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/model-context-protocol.ts#L82)
