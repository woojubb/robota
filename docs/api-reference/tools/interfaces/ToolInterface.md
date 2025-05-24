[Tools API](../../) / [Exports](../modules) / ToolInterface

# Interface: ToolInterface

Tool interface

**`Description`**

Base interface that all tools must implement.

## Implemented by

- [`BaseTool`](../classes/BaseTool)

## Table of contents

### Properties

- [description](ToolInterface#description)
- [execute](ToolInterface#execute)
- [name](ToolInterface#name)
- [schema](ToolInterface#schema)

### Methods

- [toFunctionDefinition](ToolInterface#tofunctiondefinition)

## Properties

### description

• `Optional` **description**: `string`

Tool description

#### Defined in

[packages/tools/src/tool/interfaces.ts:38](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/interfaces.ts#L38)

___

### execute

• **execute**: (`args`: `any`) => `Promise`\<`any`\>

Tool execution function

#### Type declaration

▸ (`args`): `Promise`\<`any`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `args` | `any` |

##### Returns

`Promise`\<`any`\>

#### Defined in

[packages/tools/src/tool/interfaces.ts:48](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/interfaces.ts#L48)

___

### name

• **name**: `string`

Tool name

#### Defined in

[packages/tools/src/tool/interfaces.ts:33](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/interfaces.ts#L33)

___

### schema

• **schema**: `any`

Tool schema

#### Defined in

[packages/tools/src/tool/interfaces.ts:43](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/interfaces.ts#L43)

## Methods

### toFunctionDefinition

▸ **toFunctionDefinition**(): [`FunctionDefinition`](FunctionDefinition)

Convert to function definition

#### Returns

[`FunctionDefinition`](FunctionDefinition)

#### Defined in

[packages/tools/src/tool/interfaces.ts:53](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/interfaces.ts#L53)
