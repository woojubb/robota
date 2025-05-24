[Core API](../../) / [Exports](../modules) / OpenAIProvider

# Class: OpenAIProvider

OpenAI Provider wrapper
Wraps OpenAI client with unified AIProvider interface.

## Implements

- [`AIProvider`](../interfaces/AIProvider)

## Table of contents

### Constructors

- [constructor](OpenAIProvider#constructor)

### Properties

- [name](OpenAIProvider#name)

### Methods

- [chat](OpenAIProvider#chat)
- [chatStream](OpenAIProvider#chatstream)
- [close](OpenAIProvider#close)

## Constructors

### constructor

• **new OpenAIProvider**(`client`): [`OpenAIProvider`](OpenAIProvider)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | `any` |

#### Returns

[`OpenAIProvider`](OpenAIProvider)

#### Defined in

[core/src/providers/openai-provider.ts:13](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/providers/openai-provider.ts#L13)

## Properties

### name

• `Readonly` **name**: ``"openai"``

Provider name

#### Implementation of

[AIProvider](../interfaces/AIProvider).[name](../interfaces/AIProvider#name)

#### Defined in

[core/src/providers/openai-provider.ts:9](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/providers/openai-provider.ts#L9)

## Methods

### chat

▸ **chat**(`model`, `context`, `options?`): `Promise`\<[`ModelResponse`](../interfaces/ModelResponse)\>

Chat request

#### Parameters

| Name | Type |
| :------ | :------ |
| `model` | `string` |
| `context` | [`Context`](../interfaces/Context) |
| `options?` | `any` |

#### Returns

`Promise`\<[`ModelResponse`](../interfaces/ModelResponse)\>

#### Implementation of

[AIProvider](../interfaces/AIProvider).[chat](../interfaces/AIProvider#chat)

#### Defined in

[core/src/providers/openai-provider.ts:20](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/providers/openai-provider.ts#L20)

___

### chatStream

▸ **chatStream**(`model`, `context`, `options?`): `AsyncGenerator`\<[`StreamingResponseChunk`](../interfaces/StreamingResponseChunk), `void`, `unknown`\>

Streaming chat request

#### Parameters

| Name | Type |
| :------ | :------ |
| `model` | `string` |
| `context` | [`Context`](../interfaces/Context) |
| `options?` | `any` |

#### Returns

`AsyncGenerator`\<[`StreamingResponseChunk`](../interfaces/StreamingResponseChunk), `void`, `unknown`\>

#### Implementation of

[AIProvider](../interfaces/AIProvider).[chatStream](../interfaces/AIProvider#chatstream)

#### Defined in

[core/src/providers/openai-provider.ts:86](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/providers/openai-provider.ts#L86)

___

### close

▸ **close**(): `Promise`\<`void`\>

Release resources

#### Returns

`Promise`\<`void`\>

#### Implementation of

[AIProvider](../interfaces/AIProvider).[close](../interfaces/AIProvider#close)

#### Defined in

[core/src/providers/openai-provider.ts:145](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/providers/openai-provider.ts#L145)
