[Tools API](../../) / [Exports](../modules) / ToolProvider

# Interface: ToolProvider

Tool Provider interface

Unified interface for various tool providers (MCP, OpenAPI, ZodFunction, etc.)
Tool providers enable AI models to call tools.

## Table of contents

### Properties

- [functions](ToolProvider#functions)

### Methods

- [callTool](ToolProvider#calltool)

## Properties

### functions

• `Optional` **functions**: [`FunctionSchema`](FunctionSchema)[]

List of all function schemas provided by the tool provider
Used when passing tool list to AI models.

#### Defined in

[packages/tools/src/tool-provider.ts:23](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool-provider.ts#L23)

## Methods

### callTool

▸ **callTool**(`toolName`, `parameters`): `Promise`\<`any`\>

Call a tool. All tool providers must implement this interface.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `toolName` | `string` | Name of the tool to call |
| `parameters` | `Record`\<`string`, `any`\> | Parameters to pass to the tool |

#### Returns

`Promise`\<`any`\>

Tool call result

#### Defined in

[packages/tools/src/tool-provider.ts:17](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool-provider.ts#L17)
