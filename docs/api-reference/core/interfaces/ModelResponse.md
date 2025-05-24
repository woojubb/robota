[Core API](../../) / [Exports](../modules) / ModelResponse

# Interface: ModelResponse

Model response interface

## Table of contents

### Properties

- [content](ModelResponse#content)
- [functionCall](ModelResponse#functioncall)
- [metadata](ModelResponse#metadata)
- [usage](ModelResponse#usage)

## Properties

### content

• `Optional` **content**: `string`

#### Defined in

[core/src/interfaces/ai-provider.ts:27](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/interfaces/ai-provider.ts#L27)

___

### functionCall

• `Optional` **functionCall**: [`FunctionCall`](FunctionCall)

#### Defined in

[core/src/interfaces/ai-provider.ts:28](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/interfaces/ai-provider.ts#L28)

___

### metadata

• `Optional` **metadata**: `Record`\<`string`, `any`\>

#### Defined in

[core/src/interfaces/ai-provider.ts:34](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/interfaces/ai-provider.ts#L34)

___

### usage

• `Optional` **usage**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `completionTokens` | `number` |
| `promptTokens` | `number` |
| `totalTokens` | `number` |

#### Defined in

[core/src/interfaces/ai-provider.ts:29](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/interfaces/ai-provider.ts#L29)
