<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[core](../../) / [Exports](../modules) / ConversationService

# Class: ConversationService

Conversation service class
Handles conversation processing with AI.

## Table of contents

### Constructors

- [constructor](ConversationService#constructor)

### Methods

- [prepareContext](ConversationService#preparecontext)
- [generateResponse](ConversationService#generateresponse)
- [generateStream](ConversationService#generatestream)

## Constructors

### constructor

• **new ConversationService**(`temperature?`, `maxTokens?`, `logger?`, `debug?`): [`ConversationService`](ConversationService)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `temperature?` | `number` | `undefined` |
| `maxTokens?` | `number` | `undefined` |
| `logger` | [`Logger`](../interfaces/Logger) | `console` |
| `debug` | `boolean` | `false` |

#### Returns

[`ConversationService`](ConversationService)

#### Defined in

[services/conversation-service.ts:19](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/services/conversation-service.ts#L19)

## Methods

### prepareContext

▸ **prepareContext**(`conversationHistory`, `systemPrompt?`, `systemMessages?`, `options?`): [`Context`](../interfaces/Context)

Prepare context

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `conversationHistory` | [`ConversationHistory`](../interfaces/ConversationHistory) | ConversationHistory instance |
| `systemPrompt?` | `string` | Optional system prompt |
| `systemMessages?` | [`Message`](../interfaces/Message)[] | System messages |
| `options` | [`RunOptions`](../interfaces/RunOptions) | Run options |

#### Returns

[`Context`](../interfaces/Context)

#### Defined in

[services/conversation-service.ts:39](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/services/conversation-service.ts#L39)

___

### generateResponse

▸ **generateResponse**(`aiProvider`, `model`, `context`, `options?`, `availableTools?`, `onToolCall?`): `Promise`\<[`ModelResponse`](../interfaces/ModelResponse)\>

Generate response

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `aiProvider` | [`AIProvider`](../interfaces/AIProvider) | `undefined` | AI provider |
| `model` | `string` | `undefined` | Model name |
| `context` | [`Context`](../interfaces/Context) | `undefined` | Conversation context |
| `options` | [`RunOptions`](../interfaces/RunOptions) | `{}` | Run options |
| `availableTools` | `any`[] | `[]` | Available tools |
| `onToolCall?` | (`toolName`: `string`, `params`: `any`) => `Promise`\<`any`\> | `undefined` | Tool call function |

#### Returns

`Promise`\<[`ModelResponse`](../interfaces/ModelResponse)\>

#### Defined in

[services/conversation-service.ts:75](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/services/conversation-service.ts#L75)

___

### generateStream

▸ **generateStream**(`aiProvider`, `model`, `context`, `options?`, `availableTools?`): `Promise`\<`AsyncIterable`\<[`StreamingResponseChunk`](../interfaces/StreamingResponseChunk), `any`, `any`\>\>

Generate streaming response

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `aiProvider` | [`AIProvider`](../interfaces/AIProvider) | `undefined` |
| `model` | `string` | `undefined` |
| `context` | [`Context`](../interfaces/Context) | `undefined` |
| `options` | [`RunOptions`](../interfaces/RunOptions) | `{}` |
| `availableTools` | `any`[] | `[]` |

#### Returns

`Promise`\<`AsyncIterable`\<[`StreamingResponseChunk`](../interfaces/StreamingResponseChunk), `any`, `any`\>\>

#### Defined in

[services/conversation-service.ts:240](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/services/conversation-service.ts#L240)
