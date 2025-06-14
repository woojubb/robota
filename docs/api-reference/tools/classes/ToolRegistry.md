<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[tools](../../) / [Exports](../modules) / ToolRegistry

# Class: ToolRegistry

Tool registry class

Class for registering and managing multiple tools

## Table of contents

### Constructors

- [constructor](ToolRegistry#constructor)

### Methods

- [register](ToolRegistry#register)
- [registerMany](ToolRegistry#registermany)
- [getTool](ToolRegistry#gettool)
- [getAllTools](ToolRegistry#getalltools)
- [executeTool](ToolRegistry#executetool)

## Constructors

### constructor

• **new ToolRegistry**(): [`ToolRegistry`](ToolRegistry)

#### Returns

[`ToolRegistry`](ToolRegistry)

## Methods

### register

▸ **register**(`tool`): [`ToolRegistry`](ToolRegistry)

Register a tool

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `tool` | [`Tool`](../interfaces/Tool)\<`any`, `any`\> | Tool to register |

#### Returns

[`ToolRegistry`](ToolRegistry)

#### Defined in

[packages/tools/src/index.ts:173](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/tools/src/index.ts#L173)

___

### registerMany

▸ **registerMany**(`tools`): [`ToolRegistry`](ToolRegistry)

Register multiple tools

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `tools` | [`Tool`](../interfaces/Tool)\<`any`, `any`\>[] | Array of tools to register |

#### Returns

[`ToolRegistry`](ToolRegistry)

#### Defined in

[packages/tools/src/index.ts:183](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/tools/src/index.ts#L183)

___

### getTool

▸ **getTool**(`name`): `undefined` \| [`Tool`](../interfaces/Tool)\<`any`, `any`\>

Get a tool

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | Name of the tool to get |

#### Returns

`undefined` \| [`Tool`](../interfaces/Tool)\<`any`, `any`\>

Tool or undefined

#### Defined in

[packages/tools/src/index.ts:196](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/tools/src/index.ts#L196)

___

### getAllTools

▸ **getAllTools**(): [`Tool`](../interfaces/Tool)\<`any`, `any`\>[]

Get all tools

#### Returns

[`Tool`](../interfaces/Tool)\<`any`, `any`\>[]

Array of all registered tools

#### Defined in

[packages/tools/src/index.ts:205](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/tools/src/index.ts#L205)

___

### executeTool

▸ **executeTool**\<`TInput`, `TOutput`\>(`name`, `input`): `Promise`\<[`ToolResult`](../interfaces/ToolResult)\<`TOutput`\>\>

Execute a tool

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TInput` | `any` |
| `TOutput` | `any` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | Name of the tool to execute |
| `input` | `TInput` | Tool input parameters |

#### Returns

`Promise`\<[`ToolResult`](../interfaces/ToolResult)\<`TOutput`\>\>

Tool execution result

#### Defined in

[packages/tools/src/index.ts:216](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/tools/src/index.ts#L216)
