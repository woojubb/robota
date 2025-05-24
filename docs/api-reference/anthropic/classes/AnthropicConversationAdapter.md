[Anthropic API](../../) / [Exports](../modules) / AnthropicConversationAdapter

# Class: AnthropicConversationAdapter

Anthropic ConversationHistory adapter

Converts UniversalMessage to Anthropic prompt format

## Table of contents

### Constructors

- [constructor](AnthropicConversationAdapter#constructor)

### Methods

- [convertMessage](AnthropicConversationAdapter#convertmessage)
- [extractSystemPrompt](AnthropicConversationAdapter#extractsystemprompt)
- [toAnthropicPrompt](AnthropicConversationAdapter#toanthropicprompt)

## Constructors

### constructor

• **new AnthropicConversationAdapter**(): [`AnthropicConversationAdapter`](AnthropicConversationAdapter)

#### Returns

[`AnthropicConversationAdapter`](AnthropicConversationAdapter)

## Methods

### convertMessage

▸ **convertMessage**(`msg`): `Object`

Helper for message conversion testing (converts each message individually)

#### Parameters

| Name | Type |
| :------ | :------ |
| `msg` | `UniversalMessage` |

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `content` | `string` |
| `role` | `string` |

#### Defined in

[anthropic/src/adapter.ts:68](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/anthropic/src/adapter.ts#L68)

___

### extractSystemPrompt

▸ **extractSystemPrompt**(`messages`, `fallbackSystemPrompt?`): `undefined` \| `string`

Extract system messages and combine them as system prompt

#### Parameters

| Name | Type |
| :------ | :------ |
| `messages` | `UniversalMessage`[] |
| `fallbackSystemPrompt?` | `string` |

#### Returns

`undefined` \| `string`

#### Defined in

[anthropic/src/adapter.ts:55](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/anthropic/src/adapter.ts#L55)

___

### toAnthropicPrompt

▸ **toAnthropicPrompt**(`messages`, `systemPrompt?`): `string`

Convert UniversalMessage array to Anthropic prompt format

#### Parameters

| Name | Type |
| :------ | :------ |
| `messages` | `UniversalMessage`[] |
| `systemPrompt?` | `string` |

#### Returns

`string`

#### Defined in

[anthropic/src/adapter.ts:12](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/anthropic/src/adapter.ts#L12)
