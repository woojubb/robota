[Tools API](../../) / [Exports](../modules) / ToolResult

# Interface: ToolResult\<T\>

Tool execution result type

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |

## Table of contents

### Properties

- [data](ToolResult#data)
- [error](ToolResult#error)
- [metadata](ToolResult#metadata)
- [success](ToolResult#success)

## Properties

### data

• `Optional` **data**: `T`

Tool execution result data

#### Defined in

[packages/tools/src/index.ts:34](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/index.ts#L34)

___

### error

• `Optional` **error**: `string`

Error that occurred during tool execution

#### Defined in

[packages/tools/src/index.ts:39](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/index.ts#L39)

___

### metadata

• `Optional` **metadata**: `Record`\<`string`, `any`\>

Additional metadata

#### Defined in

[packages/tools/src/index.ts:44](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/index.ts#L44)

___

### success

• **success**: `boolean`

Whether tool execution was successful

#### Defined in

[packages/tools/src/index.ts:29](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/index.ts#L29)
