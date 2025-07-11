<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[openai](../../) / [Exports](../modules) / PayloadLogger

# Class: PayloadLogger

Utility class for logging OpenAI API payloads to files

## Table of contents

### Constructors

- [constructor](PayloadLogger#constructor)

### Methods

- [logPayload](PayloadLogger#logpayload)
- [isEnabled](PayloadLogger#isenabled)

## Constructors

### constructor

• **new PayloadLogger**(`enabled?`, `logDir?`, `includeTimestamp?`): [`PayloadLogger`](PayloadLogger)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `enabled` | `boolean` | `false` |
| `logDir` | `string` | `'./logs/api-payloads'` |
| `includeTimestamp` | `boolean` | `true` |

#### Returns

[`PayloadLogger`](PayloadLogger)

#### Defined in

[openai/src/payload-logger.ts:13](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/openai/src/payload-logger.ts#L13)

## Methods

### logPayload

▸ **logPayload**(`payload`, `type?`): `Promise`\<`void`\>

Log API payload to file

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `payload` | `OpenAILogData` | `undefined` | The API request payload |
| `type` | ``"chat"`` \| ``"stream"`` | `'chat'` | Type of request ('chat' or 'stream') |

#### Returns

`Promise`\<`void`\>

#### Defined in

[openai/src/payload-logger.ts:32](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/openai/src/payload-logger.ts#L32)

___

### isEnabled

▸ **isEnabled**(): `boolean`

Check if logging is enabled

#### Returns

`boolean`

#### Defined in

[openai/src/payload-logger.ts:98](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/openai/src/payload-logger.ts#L98)
