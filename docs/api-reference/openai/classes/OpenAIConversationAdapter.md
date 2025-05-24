[OpenAI API](../../) / [Exports](../modules) / OpenAIConversationAdapter

# Class: OpenAIConversationAdapter

OpenAI ConversationHistory adapter

Converts UniversalMessage to OpenAI Chat Completions API format

## Table of contents

### Constructors

- [constructor](OpenAIConversationAdapter#constructor)

### Methods

- [addSystemPromptIfNeeded](OpenAIConversationAdapter#addsystempromptifneeded)
- [convertMessage](OpenAIConversationAdapter#convertmessage)
- [toOpenAIFormat](OpenAIConversationAdapter#toopenaiformat)

## Constructors

### constructor

• **new OpenAIConversationAdapter**(): [`OpenAIConversationAdapter`](OpenAIConversationAdapter)

#### Returns

[`OpenAIConversationAdapter`](OpenAIConversationAdapter)

## Methods

### addSystemPromptIfNeeded

▸ **addSystemPromptIfNeeded**(`messages`, `systemPrompt?`): `ChatCompletionMessageParam`[]

Add system prompt to message array if needed

#### Parameters

| Name | Type |
| :------ | :------ |
| `messages` | `ChatCompletionMessageParam`[] |
| `systemPrompt?` | `string` |

#### Returns

`ChatCompletionMessageParam`[]

#### Defined in

[openai/src/adapter.ts:73](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/openai/src/adapter.ts#L73)

___

### convertMessage

▸ **convertMessage**(`msg`): `ChatCompletionMessageParam`

Convert a single UniversalMessage to OpenAI format

#### Parameters

| Name | Type |
| :------ | :------ |
| `msg` | `UniversalMessage` |

#### Returns

`ChatCompletionMessageParam`

#### Defined in

[openai/src/adapter.ts:20](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/openai/src/adapter.ts#L20)

___

### toOpenAIFormat

▸ **toOpenAIFormat**(`messages`): `ChatCompletionMessageParam`[]

Convert UniversalMessage array to OpenAI message format

#### Parameters

| Name | Type |
| :------ | :------ |
| `messages` | `UniversalMessage`[] |

#### Returns

`ChatCompletionMessageParam`[]

#### Defined in

[openai/src/adapter.ts:13](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/openai/src/adapter.ts#L13)
