<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[agents](../../) / [Exports](../modules) / MCPToolConfig

# Interface: MCPToolConfig

MCP (Model Context Protocol) configuration

## Table of contents

### Properties

- [endpoint](MCPToolConfig#endpoint)
- [version](MCPToolConfig#version)
- [auth](MCPToolConfig#auth)
- [toolConfig](MCPToolConfig#toolconfig)
- [timeout](MCPToolConfig#timeout)

## Properties

### endpoint

• **endpoint**: `string`

MCP server endpoint

#### Defined in

[packages/agents/src/interfaces/tool.ts:159](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/interfaces/tool.ts#L159)

___

### version

• `Optional` **version**: `string`

Protocol version

#### Defined in

[packages/agents/src/interfaces/tool.ts:161](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/interfaces/tool.ts#L161)

___

### auth

• `Optional` **auth**: `Object`

Authentication configuration

#### Type declaration

| Name | Type |
| :------ | :------ |
| `type` | ``"bearer"`` \| ``"apiKey"`` |
| `token` | `string` |

#### Defined in

[packages/agents/src/interfaces/tool.ts:163](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/interfaces/tool.ts#L163)

___

### toolConfig

• `Optional` **toolConfig**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Tool-specific configuration

#### Defined in

[packages/agents/src/interfaces/tool.ts:168](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/interfaces/tool.ts#L168)

___

### timeout

• `Optional` **timeout**: `number`

Timeout in milliseconds

#### Defined in

[packages/agents/src/interfaces/tool.ts:170](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/interfaces/tool.ts#L170)
