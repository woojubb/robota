[OpenAI API](../../) / [Exports](../modules) / OpenAIProviderOptions

# Interface: OpenAIProviderOptions

OpenAI 제공업체 옵션

## Hierarchy

- `ProviderOptions`

  ↳ **`OpenAIProviderOptions`**

## Table of contents

### Properties

- [apiKey](OpenAIProviderOptions#apikey)
- [baseURL](OpenAIProviderOptions#baseurl)
- [client](OpenAIProviderOptions#client)
- [maxTokens](OpenAIProviderOptions#maxtokens)
- [model](OpenAIProviderOptions#model)
- [organization](OpenAIProviderOptions#organization)
- [responseFormat](OpenAIProviderOptions#responseformat)
- [stopSequences](OpenAIProviderOptions#stopsequences)
- [streamMode](OpenAIProviderOptions#streammode)
- [temperature](OpenAIProviderOptions#temperature)
- [timeout](OpenAIProviderOptions#timeout)

## Properties

### apiKey

• `Optional` **apiKey**: `string`

OpenAI API 키 (옵션: client를 사용하는 경우 필요하지 않음)

#### Defined in

[openai/src/types.ts:11](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/types.ts#L11)

___

### baseURL

• `Optional` **baseURL**: `string`

API 기본 URL (기본값: 'https://api.openai.com/v1')

#### Defined in

[openai/src/types.ts:26](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/types.ts#L26)

___

### client

• **client**: `OpenAI`

OpenAI 클라이언트 인스턴스 (필수)

#### Defined in

[openai/src/types.ts:36](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/types.ts#L36)

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

### organization

• `Optional` **organization**: `string`

OpenAI 조직 ID (선택사항)

#### Defined in

[openai/src/types.ts:16](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/types.ts#L16)

___

### responseFormat

• `Optional` **responseFormat**: ``"json"`` \| ``"text"``

응답 형식 (기본값: 'json')

#### Defined in

[openai/src/types.ts:31](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/types.ts#L31)

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

### timeout

• `Optional` **timeout**: `number`

API 요청 타임아웃 (밀리초)

#### Defined in

[openai/src/types.ts:21](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/openai/src/types.ts#L21)
