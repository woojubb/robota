[MCP API](../../) / [Exports](../modules) / MCPProvider

# Class: MCPProvider

MCP(Model Context Protocol) 제공업체 구현

## Implements

- `ModelContextProtocol`

## Table of contents

### Constructors

- [constructor](MCPProvider#constructor)

### Properties

- [options](MCPProvider#options)

### Methods

- [chat](MCPProvider#chat)
- [chatStream](MCPProvider#chatstream)
- [formatFunctions](MCPProvider#formatfunctions)
- [formatMessages](MCPProvider#formatmessages)
- [parseResponse](MCPProvider#parseresponse)
- [parseStreamingChunk](MCPProvider#parsestreamingchunk)

## Constructors

### constructor

• **new MCPProvider**(`options`): [`MCPProvider`](MCPProvider)

생성자

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | [`MCPProviderOptions`](../modules#mcpprovideroptions) |

#### Returns

[`MCPProvider`](MCPProvider)

#### Defined in

[mcp/src/provider.ts:39](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/provider.ts#L39)

## Properties

### options

• **options**: [`MCPProviderOptions`](../modules#mcpprovideroptions)

제공업체 옵션

#### Implementation of

ModelContextProtocol.options

#### Defined in

[mcp/src/provider.ts:29](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/provider.ts#L29)

## Methods

### chat

▸ **chat**(`context`): `Promise`\<`ModelResponse`\>

모델 채팅 요청

#### Parameters

| Name | Type |
| :------ | :------ |
| `context` | `Context` |

#### Returns

`Promise`\<`ModelResponse`\>

#### Implementation of

ModelContextProtocol.chat

#### Defined in

[mcp/src/provider.ts:204](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/provider.ts#L204)

___

### chatStream

▸ **chatStream**(`context`): `AsyncGenerator`\<`StreamingResponseChunk`, `void`, `unknown`\>

모델 채팅 스트리밍 요청

#### Parameters

| Name | Type |
| :------ | :------ |
| `context` | `Context` |

#### Returns

`AsyncGenerator`\<`StreamingResponseChunk`, `void`, `unknown`\>

#### Implementation of

ModelContextProtocol.chatStream

#### Defined in

[mcp/src/provider.ts:247](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/provider.ts#L247)

___

### formatFunctions

▸ **formatFunctions**(`functions`): `any`[]

함수 정의를 MCP 형식으로 변환

#### Parameters

| Name | Type |
| :------ | :------ |
| `functions` | `FunctionDefinition`[] |

#### Returns

`any`[]

#### Implementation of

ModelContextProtocol.formatFunctions

#### Defined in

[mcp/src/provider.ts:99](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/provider.ts#L99)

___

### formatMessages

▸ **formatMessages**(`messages`): `any`[]

메시지를 MCP 형식으로 변환

#### Parameters

| Name | Type |
| :------ | :------ |
| `messages` | `Message`[] |

#### Returns

`any`[]

#### Implementation of

ModelContextProtocol.formatMessages

#### Defined in

[mcp/src/provider.ts:82](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/provider.ts#L82)

___

### parseResponse

▸ **parseResponse**(`response`): `ModelResponse`

MCP 응답을 표준 형식으로 변환

#### Parameters

| Name | Type |
| :------ | :------ |
| `response` | `any` |

#### Returns

`ModelResponse`

#### Implementation of

ModelContextProtocol.parseResponse

#### Defined in

[mcp/src/provider.ts:112](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/provider.ts#L112)

___

### parseStreamingChunk

▸ **parseStreamingChunk**(`chunk`): `StreamingResponseChunk`

스트리밍 응답 청크를 표준 형식으로 변환

#### Parameters

| Name | Type |
| :------ | :------ |
| `chunk` | `any` |

#### Returns

`StreamingResponseChunk`

#### Implementation of

ModelContextProtocol.parseStreamingChunk

#### Defined in

[mcp/src/provider.ts:162](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/provider.ts#L162)
