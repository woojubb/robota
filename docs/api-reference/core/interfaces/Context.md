[Core API](../../) / [Exports](../modules) / Context

# Interface: Context

Conversation context interface

## Table of contents

### Properties

- [messages](Context#messages)
- [metadata](Context#metadata)
- [systemMessages](Context#systemmessages)
- [systemPrompt](Context#systemprompt)

## Properties

### messages

• **messages**: [`UniversalMessage`](UniversalMessage)[]

#### Defined in

[core/src/interfaces/ai-provider.ts:50](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/interfaces/ai-provider.ts#L50)

___

### metadata

• `Optional` **metadata**: `Record`\<`string`, `any`\>

#### Defined in

[core/src/interfaces/ai-provider.ts:53](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/interfaces/ai-provider.ts#L53)

___

### systemMessages

• `Optional` **systemMessages**: [`Message`](Message)[]

#### Defined in

[core/src/interfaces/ai-provider.ts:52](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/interfaces/ai-provider.ts#L52)

___

### systemPrompt

• `Optional` **systemPrompt**: `string`

#### Defined in

[core/src/interfaces/ai-provider.ts:51](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/interfaces/ai-provider.ts#L51)
