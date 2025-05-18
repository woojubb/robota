[Tools API](../../) / [Exports](../modules) / CreateToolOptions

# Interface: CreateToolOptions\<TInput, TOutput\>

도구 생성 옵션

## Type parameters

| Name | Type |
| :------ | :------ |
| `TInput` | `any` |
| `TOutput` | `any` |

## Table of contents

### Properties

- [description](CreateToolOptions#description)
- [execute](CreateToolOptions#execute)
- [name](CreateToolOptions#name)
- [parameters](CreateToolOptions#parameters)

## Properties

### description

• `Optional` **description**: `string`

도구 설명

#### Defined in

[index.ts:83](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L83)

___

### execute

• **execute**: (`input`: `TInput`) => `Promise`\<`TOutput` \| [`ToolResult`](ToolResult)\<`TOutput`\>\>

도구 실행 함수

#### Type declaration

▸ (`input`): `Promise`\<`TOutput` \| [`ToolResult`](ToolResult)\<`TOutput`\>\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `input` | `TInput` |

##### Returns

`Promise`\<`TOutput` \| [`ToolResult`](ToolResult)\<`TOutput`\>\>

#### Defined in

[index.ts:93](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L93)

___

### name

• **name**: `string`

도구 이름

#### Defined in

[index.ts:78](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L78)

___

### parameters

• `Optional` **parameters**: [`ToolParameter`](ToolParameter)[]

도구 파라미터 정의

#### Defined in

[index.ts:88](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L88)
