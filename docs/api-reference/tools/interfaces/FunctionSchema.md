[Tools API](../../) / [Exports](../modules) / FunctionSchema

# Interface: FunctionSchema

Function schema interface

## Table of contents

### Properties

- [description](FunctionSchema#description)
- [name](FunctionSchema#name)
- [parameters](FunctionSchema#parameters)

## Properties

### description

• `Optional` **description**: `string`

#### Defined in

[packages/tools/src/types.ts:6](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/types.ts#L6)

___

### name

• **name**: `string`

#### Defined in

[packages/tools/src/types.ts:5](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/types.ts#L5)

___

### parameters

• **parameters**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `properties` | `Record`\<`string`, \{ `default?`: `any` ; `description?`: `string` ; `enum?`: `any`[] ; `type`: `string`  }\> |
| `required?` | `string`[] |
| `type` | ``"object"`` |

#### Defined in

[packages/tools/src/types.ts:7](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/types.ts#L7)
