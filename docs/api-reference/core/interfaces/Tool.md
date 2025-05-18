[Core API](../../) / [Exports](../modules) / Tool

# Interface: Tool

도구 인터페이스

## Implemented by

- [`SimpleTool`](../classes/SimpleTool)

## Table of contents

### Properties

- [description](Tool#description)
- [execute](Tool#execute)
- [name](Tool#name)
- [schema](Tool#schema)

### Methods

- [toFunctionDefinition](Tool#tofunctiondefinition)

## Properties

### description

• `Optional` **description**: `string`

도구 설명

#### Defined in

[packages/core/src/tools.ts:16](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L16)

___

### execute

• **execute**: (`args`: `any`) => `Promise`\<`any`\>

도구 실행 함수

#### Type declaration

▸ (`args`): `Promise`\<`any`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `args` | `any` |

##### Returns

`Promise`\<`any`\>

#### Defined in

[packages/core/src/tools.ts:26](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L26)

___

### name

• **name**: `string`

도구 이름

#### Defined in

[packages/core/src/tools.ts:11](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L11)

___

### schema

• **schema**: `ZodObject`\<`any`, `UnknownKeysParam`, `ZodTypeAny`, {}, {}\>

도구 매개변수 스키마

#### Defined in

[packages/core/src/tools.ts:21](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L21)

## Methods

### toFunctionDefinition

▸ **toFunctionDefinition**(): [`FunctionDefinition`](FunctionDefinition)

함수 정의로 변환

#### Returns

[`FunctionDefinition`](FunctionDefinition)

#### Defined in

[packages/core/src/tools.ts:31](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L31)
