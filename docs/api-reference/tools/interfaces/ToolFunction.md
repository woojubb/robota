<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[tools](../../) / [Exports](../modules) / ToolFunction

# Interface: ToolFunction\<TParams, TResult\>

Function interface

## Type parameters

| Name | Type |
| :------ | :------ |
| `TParams` | `unknown` |
| `TResult` | `unknown` |

## Table of contents

### Properties

- [name](ToolFunction#name)
- [description](ToolFunction#description)
- [schema](ToolFunction#schema)
- [execute](ToolFunction#execute)

## Properties

### name

• **name**: `string`

#### Defined in

[packages/tools/src/function.ts:34](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/tools/src/function.ts#L34)

___

### description

• `Optional` **description**: `string`

#### Defined in

[packages/tools/src/function.ts:35](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/tools/src/function.ts#L35)

___

### schema

• **schema**: [`FunctionDefinition`](FunctionDefinition)

#### Defined in

[packages/tools/src/function.ts:36](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/tools/src/function.ts#L36)

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

[packages/tools/src/function.ts:37](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/tools/src/function.ts#L37)
