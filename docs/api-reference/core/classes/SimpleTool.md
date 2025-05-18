[Core API](../../) / [Exports](../modules) / SimpleTool

# Class: SimpleTool

도구 클래스

## Implements

- [`Tool`](../interfaces/Tool)

## Table of contents

### Constructors

- [constructor](SimpleTool#constructor)

### Properties

- [description](SimpleTool#description)
- [execute](SimpleTool#execute)
- [name](SimpleTool#name)
- [schema](SimpleTool#schema)

### Methods

- [toFunctionDefinition](SimpleTool#tofunctiondefinition)

## Constructors

### constructor

• **new SimpleTool**(`options`): [`SimpleTool`](SimpleTool)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | [`ToolOptions`](../interfaces/ToolOptions) |

#### Returns

[`SimpleTool`](SimpleTool)

#### Defined in

[packages/core/src/tools.ts:53](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L53)

## Properties

### description

• `Optional` **description**: `string`

도구 설명

#### Implementation of

[Tool](../interfaces/Tool).[description](../interfaces/Tool#description)

#### Defined in

[packages/core/src/tools.ts:49](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L49)

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

#### Implementation of

[Tool](../interfaces/Tool).[execute](../interfaces/Tool#execute)

#### Defined in

[packages/core/src/tools.ts:51](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L51)

___

### name

• **name**: `string`

도구 이름

#### Implementation of

[Tool](../interfaces/Tool).[name](../interfaces/Tool#name)

#### Defined in

[packages/core/src/tools.ts:48](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L48)

___

### schema

• **schema**: `ZodObject`\<`any`, `UnknownKeysParam`, `ZodTypeAny`, {}, {}\>

도구 매개변수 스키마

#### Implementation of

[Tool](../interfaces/Tool).[schema](../interfaces/Tool#schema)

#### Defined in

[packages/core/src/tools.ts:50](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L50)

## Methods

### toFunctionDefinition

▸ **toFunctionDefinition**(): [`FunctionDefinition`](../interfaces/FunctionDefinition)

함수 정의로 변환

#### Returns

[`FunctionDefinition`](../interfaces/FunctionDefinition)

#### Implementation of

[Tool](../interfaces/Tool).[toFunctionDefinition](../interfaces/Tool#tofunctiondefinition)

#### Defined in

[packages/core/src/tools.ts:63](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L63)
