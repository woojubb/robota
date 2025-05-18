[MCP API](../../) / [Exports](../modules) / MCPClient

# Interface: MCPClient

MCP 클라이언트 인터페이스
@modelcontextprotocol/sdk의 Client와 호환됩니다

## Table of contents

### Properties

- [chat](MCPClient#chat)
- [stream](MCPClient#stream)

## Properties

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

[mcp/src/types.ts:9](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/types.ts#L9)

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

[mcp/src/types.ts:10](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/types.ts#L10)
