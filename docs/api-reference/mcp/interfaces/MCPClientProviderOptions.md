[MCP API](../../) / [Exports](../modules) / MCPClientProviderOptions

# Interface: MCPClientProviderOptions

MCP 제공업체 옵션 - Client 방식

## Hierarchy

- `ProviderOptions`

  ↳ **`MCPClientProviderOptions`**

## Table of contents

### Properties

- [client](MCPClientProviderOptions#client)
- [maxTokens](MCPClientProviderOptions#maxtokens)
- [model](MCPClientProviderOptions#model)
- [stopSequences](MCPClientProviderOptions#stopsequences)
- [streamMode](MCPClientProviderOptions#streammode)
- [temperature](MCPClientProviderOptions#temperature)
- [type](MCPClientProviderOptions#type)

## Properties

### client

• **client**: [`MCPClient`](MCPClient)

MCP 클라이언트 인스턴스 (필수)

#### Defined in

[mcp/src/types.ts:21](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/types.ts#L21)

___

### maxTokens

• `Optional` **maxTokens**: `number`

#### Inherited from

ProviderOptions.maxTokens

#### Defined in

core/dist/index.d.ts:93

___

### model

• **model**: `string`

#### Inherited from

ProviderOptions.model

#### Defined in

core/dist/index.d.ts:91

___

### stopSequences

• `Optional` **stopSequences**: `string`[]

#### Inherited from

ProviderOptions.stopSequences

#### Defined in

core/dist/index.d.ts:94

___

### streamMode

• `Optional` **streamMode**: `boolean`

#### Inherited from

ProviderOptions.streamMode

#### Defined in

core/dist/index.d.ts:95

___

### temperature

• `Optional` **temperature**: `number`

#### Inherited from

ProviderOptions.temperature

#### Defined in

core/dist/index.d.ts:92

___

### type

• **type**: ``"client"``

클라이언트 타입을 'client'로 지정

#### Defined in

[mcp/src/types.ts:26](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/types.ts#L26)
