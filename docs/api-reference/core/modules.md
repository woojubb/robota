[Core API](../) / Exports

# Core API

## Table of contents

### Classes

- [FunctionRegistry](classes/FunctionRegistry)
- [PersistentSystemMemory](classes/PersistentSystemMemory)
- [Robota](classes/Robota)
- [SimpleMemory](classes/SimpleMemory)
- [SimpleTool](classes/SimpleTool)
- [ToolRegistry](classes/ToolRegistry)

### Interfaces

- [AIClient](interfaces/AIClient)
- [Context](interfaces/Context)
- [FunctionCall](interfaces/FunctionCall)
- [FunctionCallConfig](interfaces/FunctionCallConfig)
- [FunctionCallResult](interfaces/FunctionCallResult)
- [FunctionDefinition](interfaces/FunctionDefinition)
- [FunctionSchema](interfaces/FunctionSchema)
- [MCPClient](interfaces/MCPClient)
- [Memory](interfaces/Memory)
- [Message](interfaces/Message)
- [ModelContextProtocol](interfaces/ModelContextProtocol)
- [ModelResponse](interfaces/ModelResponse)
- [ProviderOptions](interfaces/ProviderOptions)
- [RobotaOptions](interfaces/RobotaOptions)
- [RunOptions](interfaces/RunOptions)
- [StreamingResponseChunk](interfaces/StreamingResponseChunk)
- [Tool](interfaces/Tool)
- [ToolOptions](interfaces/ToolOptions)

### Type Aliases

- [AIClientType](modules#aiclienttype)
- [FunctionCallMode](modules#functioncallmode)
- [FunctionHandler](modules#functionhandler)
- [MessageRole](modules#messagerole)

### Variables

- [logger](modules#logger)

### Functions

- [createFunctionSchema](modules#createfunctionschema)
- [delay](modules#delay)
- [estimateTokenCount](modules#estimatetokencount)
- [extractJSONObjects](modules#extractjsonobjects)
- [isJSON](modules#isjson)
- [removeUndefined](modules#removeundefined)
- [splitTextIntoChunks](modules#splittextintochunks)

## Type Aliases

### AIClientType

Ƭ **AIClientType**: ``"openai"`` \| ``"anthropic"`` \| ``"google"`` \| ``"cohere"`` \| `string`

AI 제공업체 클라이언트 타입

#### Defined in

[packages/core/src/types.ts:147](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L147)

___

### FunctionCallMode

Ƭ **FunctionCallMode**: ``"auto"`` \| ``"force"`` \| ``"disabled"``

함수 호출 모드

#### Defined in

[packages/core/src/types.ts:107](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L107)

___

### FunctionHandler

Ƭ **FunctionHandler**: (`args`: `Record`\<`string`, `any`\>, `context?`: `any`) => `Promise`\<`any`\>

함수 호출 핸들러 타입

#### Type declaration

▸ (`args`, `context?`): `Promise`\<`any`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `args` | `Record`\<`string`, `any`\> |
| `context?` | `any` |

##### Returns

`Promise`\<`any`\>

#### Defined in

[packages/core/src/function-calling.ts:40](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/function-calling.ts#L40)

___

### MessageRole

Ƭ **MessageRole**: ``"user"`` \| ``"assistant"`` \| ``"system"`` \| ``"function"``

메시지 역할 타입

#### Defined in

[packages/core/src/types.ts:4](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L4)

## Variables

### logger

• `Const` **logger**: `Object`

logger 유틸리티 (console.log 대체)

#### Type declaration

| Name | Type |
| :------ | :------ |
| `error` | (...`args`: `any`[]) => `void` |
| `info` | (...`args`: `any`[]) => `void` |
| `warn` | (...`args`: `any`[]) => `void` |

#### Defined in

[packages/core/src/utils.ts:128](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/utils.ts#L128)

## Functions

### createFunctionSchema

▸ **createFunctionSchema**(`definition`): `ZodObject`\<`Record`\<`string`, `ZodTypeAny`\>, ``"strip"``, `ZodTypeAny`, {}, {}\>

함수 스키마를 Zod 스키마로 변환하는 유틸리티 함수

#### Parameters

| Name | Type |
| :------ | :------ |
| `definition` | [`FunctionDefinition`](interfaces/FunctionDefinition) |

#### Returns

`ZodObject`\<`Record`\<`string`, `ZodTypeAny`\>, ``"strip"``, `ZodTypeAny`, {}, {}\>

#### Defined in

[packages/core/src/function-calling.ts:7](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/function-calling.ts#L7)

___

### delay

▸ **delay**(`ms`): `Promise`\<`void`\>

지연 함수

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `ms` | `number` | 지연 시간(밀리초) |

#### Returns

`Promise`\<`void`\>

Promise

#### Defined in

[packages/core/src/utils.ts:63](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/utils.ts#L63)

___

### estimateTokenCount

▸ **estimateTokenCount**(`text`): `number`

토큰 수 대략적 추정 함수

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `text` | `string` | 측정할 텍스트 |

#### Returns

`number`

대략적인 토큰 수

#### Defined in

[packages/core/src/utils.ts:73](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/utils.ts#L73)

___

### extractJSONObjects

▸ **extractJSONObjects**(`text`): `Object`

문자열 스트림에서 완성된 JSON 객체를 추출하는 함수

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `text` | `string` | JSON 문자열 조각 |

#### Returns

`Object`

완성된 JSON 객체와 남은 문자열

| Name | Type |
| :------ | :------ |
| `objects` | `any`[] |
| `remaining` | `string` |

#### Defined in

[packages/core/src/utils.ts:96](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/utils.ts#L96)

___

### isJSON

▸ **isJSON**(`str`): `boolean`

문자열이 JSON인지 확인하는 함수

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `str` | `string` | 확인할 문자열 |

#### Returns

`boolean`

JSON 여부

#### Defined in

[packages/core/src/utils.ts:48](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/utils.ts#L48)

___

### removeUndefined

▸ **removeUndefined**\<`T`\>(`obj`): `T`

객체에서 undefined 값을 제거하는 함수

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `Record`\<`string`, `any`\> |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `obj` | `T` | 정리할 객체 |

#### Returns

`T`

undefined 값이 제거된 객체

#### Defined in

[packages/core/src/utils.ts:28](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/utils.ts#L28)

___

### splitTextIntoChunks

▸ **splitTextIntoChunks**(`text`, `chunkSize`): `string`[]

문자열을 청크로 나누는 함수

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `text` | `string` | 나눌 문자열 |
| `chunkSize` | `number` | 각 청크의 최대 크기 |

#### Returns

`string`[]

문자열 청크 배열

#### Defined in

[packages/core/src/utils.ts:12](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/utils.ts#L12)
