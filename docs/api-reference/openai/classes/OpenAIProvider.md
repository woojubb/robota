[OpenAI API](../../) / [Exports](../modules) / OpenAIProvider

# Class: OpenAIProvider

OpenAI 제공업체 구현

## Implements

- `ModelContextProtocol`

## Table of contents

### Constructors

- [constructor](OpenAIProvider#constructor)

### Properties

- [options](OpenAIProvider#options)

### Methods

- [chat](OpenAIProvider#chat)
- [chatStream](OpenAIProvider#chatstream)
- [formatFunctions](OpenAIProvider#formatfunctions)
- [formatMessages](OpenAIProvider#formatmessages)
- [parseResponse](OpenAIProvider#parseresponse)
- [parseStreamingChunk](OpenAIProvider#parsestreamingchunk)

## Constructors

### constructor

• **new OpenAIProvider**(`options`): [`OpenAIProvider`](OpenAIProvider)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | [`OpenAIProviderOptions`](../interfaces/OpenAIProviderOptions) |

#### Returns

[`OpenAIProvider`](OpenAIProvider)

#### Defined in

[openai/src/provider.ts:28](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/provider.ts#L28)

## Properties

### options

• **options**: [`OpenAIProviderOptions`](../interfaces/OpenAIProviderOptions)

제공업체 옵션

#### Implementation of

ModelContextProtocol.options

#### Defined in

[openai/src/provider.ts:26](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/provider.ts#L26)

## Methods

### chat

▸ **chat**(`context`, `options?`): `Promise`\<`ModelResponse`\>

모델 채팅 요청

#### Parameters

| Name | Type |
| :------ | :------ |
| `context` | `Context` |
| `options?` | `any` |

#### Returns

`Promise`\<`ModelResponse`\>

#### Implementation of

ModelContextProtocol.chat

#### Defined in

[openai/src/provider.ts:169](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/provider.ts#L169)

___

### chatStream

▸ **chatStream**(`context`, `options?`): `AsyncGenerator`\<`StreamingResponseChunk`, `void`, `unknown`\>

모델 채팅 스트리밍 요청

#### Parameters

| Name | Type |
| :------ | :------ |
| `context` | `Context` |
| `options?` | `any` |

#### Returns

`AsyncGenerator`\<`StreamingResponseChunk`, `void`, `unknown`\>

#### Implementation of

ModelContextProtocol.chatStream

#### Defined in

[openai/src/provider.ts:229](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/provider.ts#L229)

___

### formatFunctions

▸ **formatFunctions**(`functions`): `ChatCompletionTool`[]

함수 정의를 OpenAI 형식으로 변환

#### Parameters

| Name | Type |
| :------ | :------ |
| `functions` | `FunctionDefinition`[] |

#### Returns

`ChatCompletionTool`[]

#### Implementation of

ModelContextProtocol.formatFunctions

#### Defined in

[openai/src/provider.ts:103](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/provider.ts#L103)

___

### formatMessages

▸ **formatMessages**(`messages`): `ChatCompletionMessageParam`[]

메시지를 OpenAI 형식으로 변환

#### Parameters

| Name | Type |
| :------ | :------ |
| `messages` | `Message`[] |

#### Returns

`ChatCompletionMessageParam`[]

#### Implementation of

ModelContextProtocol.formatMessages

#### Defined in

[openai/src/provider.ts:46](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/provider.ts#L46)

___

### parseResponse

▸ **parseResponse**(`response`): `ModelResponse`

OpenAI API 응답을 표준 형식으로 변환

#### Parameters

| Name | Type |
| :------ | :------ |
| `response` | `ChatCompletion` |

#### Returns

`ModelResponse`

#### Implementation of

ModelContextProtocol.parseResponse

#### Defined in

[openai/src/provider.ts:117](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/provider.ts#L117)

___

### parseStreamingChunk

▸ **parseStreamingChunk**(`chunk`): `StreamingResponseChunk`

스트리밍 응답 청크를 표준 형식으로 변환

#### Parameters

| Name | Type |
| :------ | :------ |
| `chunk` | `ChatCompletionChunk` |

#### Returns

`StreamingResponseChunk`

#### Implementation of

ModelContextProtocol.parseStreamingChunk

#### Defined in

[openai/src/provider.ts:147](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/provider.ts#L147)
