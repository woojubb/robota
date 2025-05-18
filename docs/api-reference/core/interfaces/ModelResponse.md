[Core API](../../) / [Exports](../modules) / ModelResponse

# Interface: ModelResponse

모델 응답 인터페이스

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

[packages/core/src/types.ts:74](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L74)

___

### functionCall

• `Optional` **functionCall**: [`FunctionCall`](FunctionCall)

#### Defined in

[packages/core/src/types.ts:75](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L75)

___

### metadata

• `Optional` **metadata**: `Record`\<`string`, `any`\>

#### Defined in

[packages/core/src/types.ts:81](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L81)

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

[packages/core/src/types.ts:76](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L76)
