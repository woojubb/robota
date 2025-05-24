[Tools API](../../) / [Exports](../modules) / FunctionOptions

# Interface: FunctionOptions\<TParams, TResult\>

Function options interface

## Type parameters

| Name | Type |
| :------ | :------ |
| `TParams` | `unknown` |
| `TResult` | `unknown` |

## Table of contents

### Properties

- [description](FunctionOptions#description)
- [execute](FunctionOptions#execute)
- [name](FunctionOptions#name)
- [parameters](FunctionOptions#parameters)

## Properties

### description

• `Optional` **description**: `string`

#### Defined in

[packages/tools/src/function.ts:25](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/function.ts#L25)

___

### execute

• **execute**: (`params`: `TParams`) => `TResult` \| `Promise`\<`TResult`\>

#### Type declaration

▸ (`params`): `TResult` \| `Promise`\<`TResult`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `params` | `TParams` |

##### Returns

`TResult` \| `Promise`\<`TResult`\>

#### Defined in

[packages/tools/src/function.ts:27](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/function.ts#L27)

___

### name

• **name**: `string`

#### Defined in

[packages/tools/src/function.ts:24](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/function.ts#L24)

___

### parameters

• **parameters**: `any`

#### Defined in

[packages/tools/src/function.ts:26](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/function.ts#L26)
