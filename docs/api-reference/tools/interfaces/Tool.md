[Tools API](../../) / [Exports](../modules) / Tool

# Interface: Tool\<TInput, TOutput\>

도구 인터페이스

## Type parameters

| Name | Type |
| :------ | :------ |
| `TInput` | `any` |
| `TOutput` | `any` |

## Table of contents

### Properties

- [description](Tool#description)
- [execute](Tool#execute)
- [name](Tool#name)
- [parameters](Tool#parameters)

## Properties

### description

• `Optional` **description**: `string`

도구 설명

#### Defined in

[index.ts:55](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L55)

___

### execute

• **execute**: (`input`: `TInput`) => `Promise`\<[`ToolResult`](ToolResult)\<`TOutput`\>\>

도구 실행 함수

#### Type declaration

▸ (`input`): `Promise`\<[`ToolResult`](ToolResult)\<`TOutput`\>\>

##### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `input` | `TInput` | 도구 입력 파라미터 |

##### Returns

`Promise`\<[`ToolResult`](ToolResult)\<`TOutput`\>\>

#### Defined in

[index.ts:68](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L68)

___

### name

• **name**: `string`

도구 이름

#### Defined in

[index.ts:50](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L50)

___

### parameters

• `Optional` **parameters**: [`ToolParameter`](ToolParameter)[]

도구 파라미터 정의

#### Defined in

[index.ts:60](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L60)
