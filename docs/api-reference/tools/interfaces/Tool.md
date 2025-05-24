[Tools API](../../) / [Exports](../modules) / Tool

# Interface: Tool\<TInput, TOutput\>

Tool interface

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

Tool description

#### Defined in

[packages/tools/src/index.ts:70](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/index.ts#L70)

___

### execute

• **execute**: (`input`: `TInput`) => `Promise`\<[`ToolResult`](ToolResult)\<`TOutput`\>\>

Tool execution function

#### Type declaration

▸ (`input`): `Promise`\<[`ToolResult`](ToolResult)\<`TOutput`\>\>

##### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `input` | `TInput` | Tool input parameters |

##### Returns

`Promise`\<[`ToolResult`](ToolResult)\<`TOutput`\>\>

#### Defined in

[packages/tools/src/index.ts:83](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/index.ts#L83)

___

### name

• **name**: `string`

Tool name

#### Defined in

[packages/tools/src/index.ts:65](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/index.ts#L65)

___

### parameters

• `Optional` **parameters**: [`ToolParameter`](ToolParameter)[]

Tool parameter definitions

#### Defined in

[packages/tools/src/index.ts:75](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/index.ts#L75)
