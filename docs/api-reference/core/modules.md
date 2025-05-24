[Core API](../) / Exports

# Core API

## Table of contents

### Classes

- [AIProviderManager](classes/AIProviderManager)
- [ConversationService](classes/ConversationService)
- [FunctionCallManager](classes/FunctionCallManager)
- [PersistentSystemMemory](classes/PersistentSystemMemory)
- [Robota](classes/Robota)
- [SimpleMemory](classes/SimpleMemory)
- [SystemMessageManager](classes/SystemMessageManager)
- [ToolProviderManager](classes/ToolProviderManager)

### Interfaces

- [AIProvider](interfaces/AIProvider)
- [Context](interfaces/Context)
- [FunctionCallConfig](interfaces/FunctionCallConfig)
- [Logger](interfaces/Logger)
- [Memory](interfaces/Memory)
- [Message](interfaces/Message)
- [ModelResponse](interfaces/ModelResponse)
- [ProviderOptions](interfaces/ProviderOptions)
- [RobotaOptions](interfaces/RobotaOptions)
- [RunOptions](interfaces/RunOptions)
- [StreamingResponseChunk](interfaces/StreamingResponseChunk)

### Type Aliases

- [FunctionCallMode](modules#functioncallmode)
- [MessageRole](modules#messagerole)

### Variables

- [logger](modules#logger)

### Functions

- [delay](modules#delay)
- [estimateTokenCount](modules#estimatetokencount)
- [extractJSONObjects](modules#extractjsonobjects)
- [isJSON](modules#isjson)
- [removeUndefined](modules#removeundefined)
- [splitTextIntoChunks](modules#splittextintochunks)

### Re-exported from @robota-sdk/tools

The following items are re-exported from `@robota-sdk/tools` for backward compatibility:

#### Types
- [FunctionCall](modules#functioncall)
- [FunctionCallResult](modules#functioncallresult)
- [FunctionDefinition](modules#functiondefinition)
- [FunctionSchema](modules#functionschema)
- [ToolProvider](modules#toolprovider)

#### Classes
- [FunctionRegistry](modules#functionregistry)

#### Functions
- [createFunction](modules#createfunction)
- [createFunctionSchema](modules#createfunctionschema)
- [functionFromCallback](modules#functionfromcallback)

## Type Aliases

### FunctionCallMode

Ƭ **FunctionCallMode**: ``"auto"`` \| ``"force"`` \| ``"disabled"``

함수 호출 모드

#### Defined in

[packages/core/src/types.ts:107](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L107)

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
| `T` | extends `Record`\<`string`, `