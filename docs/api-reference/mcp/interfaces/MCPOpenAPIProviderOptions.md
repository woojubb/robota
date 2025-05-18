[MCP API](../../) / [Exports](../modules) / MCPOpenAPIProviderOptions

# Interface: MCPOpenAPIProviderOptions

OpenAPI 스키마 기반 MCP 제공업체 옵션

## Hierarchy

- `ProviderOptions`

  ↳ **`MCPOpenAPIProviderOptions`**

## Table of contents

### Properties

- [baseURL](MCPOpenAPIProviderOptions#baseurl)
- [headers](MCPOpenAPIProviderOptions#headers)
- [maxTokens](MCPOpenAPIProviderOptions#maxtokens)
- [model](MCPOpenAPIProviderOptions#model)
- [schema](MCPOpenAPIProviderOptions#schema)
- [stopSequences](MCPOpenAPIProviderOptions#stopsequences)
- [streamMode](MCPOpenAPIProviderOptions#streammode)
- [temperature](MCPOpenAPIProviderOptions#temperature)
- [type](MCPOpenAPIProviderOptions#type)

## Properties

### baseURL

• `Optional` **baseURL**: `string`

엔드포인트 기본 URL

#### Defined in

[mcp/src/types.ts:42](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/types.ts#L42)

___

### headers

• `Optional` **headers**: `Record`\<`string`, `string`\>

API 요청 헤더

#### Defined in

[mcp/src/types.ts:47](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/types.ts#L47)

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

### schema

• **schema**: `string` \| `object`

OpenAPI 스키마 문서 (필수)
JSON 객체 또는 스키마의 URL

#### Defined in

[mcp/src/types.ts:37](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/types.ts#L37)

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

• **type**: ``"openapi"``

클라이언트 타입을 'openapi'로 지정

#### Defined in

[mcp/src/types.ts:52](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/mcp/src/types.ts#L52)
