[Tools API](../../) / [Exports](../modules) / ToolFunction

# Interface: ToolFunction\<TParams, TResult\>

Function interface

## Type parameters

| Name | Type |
| :------ | :------ |
| `TParams` | `unknown` |
| `TResult` | `unknown` |

## Table of contents

### Properties

- [description](ToolFunction#description)
- [execute](ToolFunction#execute)
- [name](ToolFunction#name)
- [schema](ToolFunction#schema)

## Properties

### description

• `Optional` **description**: `string`

#### Defined in

[packages/tools/src/function.ts:35](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/function.ts#L35)

___

### execute

• **execute**: (`params`: `TParams`) => `Promise`\<`TResult`\>

#### Type declaration

▸ (`params`): `Promise`\<`TResult`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `params` | `TParams` |

##### Returns

`Promise`\<`TResult`\>

#### Defined in

[packages/tools/src/function.ts:37](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/function.ts#L37)

___

### name

• **name**: `string`

#### Defined in

[packages/tools/src/function.ts:34](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/function.ts#L34)

___

### schema

• **schema**: [`FunctionDefinition`](FunctionDefinition)

#### Defined in

[packages/tools/src/function.ts:36](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/function.ts#L36)
