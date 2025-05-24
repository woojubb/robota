[Tools API](../../) / [Exports](../modules) / MCPClient

# Interface: MCPClient

MCP client interface
Compatible with Client from @modelcontextprotocol/sdk

## Table of contents

### Properties

- [callTool](MCPClient#calltool)
- [chat](MCPClient#chat)
- [stream](MCPClient#stream)

## Properties

### callTool

• **callTool**: (`toolName`: `string`, `parameters`: `Record`\<`string`, `any`\>) => `Promise`\<`any`\>

#### Type declaration

▸ (`toolName`, `parameters`): `Promise`\<`any`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `toolName` | `string` |
| `parameters` | `Record`\<`string`, `any`\> |

##### Returns

`Promise`\<`any`\>

#### Defined in

[packages/tools/src/mcp-tool-provider.ts:12](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/mcp-tool-provider.ts#L12)

___

### chat

• **chat**: (`options`: `any`) => `Promise`\<`any`\>

#### Type declaration

▸ (`options`): `Promise`\<`any`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `any` |

##### Returns

`Promise`\<`any`\>

#### Defined in

[packages/tools/src/mcp-tool-provider.ts:9](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/mcp-tool-provider.ts#L9)

___

### stream

• **stream**: (`options`: `any`) => `AsyncIterable`\<`any`, `any`, `any`\>

#### Type declaration

▸ (`options`): `AsyncIterable`\<`any`, `any`, `any`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `any` |

##### Returns

`AsyncIterable`\<`any`, `any`, `any`\>

#### Defined in

[packages/tools/src/mcp-tool-provider.ts:10](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/mcp-tool-provider.ts#L10)
