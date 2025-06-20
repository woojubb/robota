<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[core](../../) / [Exports](../modules) / RobotaCore

# Interface: RobotaCore

Core execution interface for Robota
Contains only essential execution methods

## Hierarchy

- **`RobotaCore`**

  ↳ [`RobotaComplete`](RobotaComplete)

## Table of contents

### Methods

- [run](RobotaCore#run)
- [runStream](RobotaCore#runstream)
- [close](RobotaCore#close)

## Methods

### run

▸ **run**(`prompt`, `options?`): `Promise`\<`string`\>

Execute AI conversation with prompt

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `prompt` | `string` | User input text |
| `options?` | [`RunOptions`](RunOptions) | Optional run configuration |

#### Returns

`Promise`\<`string`\>

Promise resolving to AI response text

#### Defined in

[packages/core/src/interfaces/robota-core.ts:18](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/core/src/interfaces/robota-core.ts#L18)

___

### runStream

▸ **runStream**(`prompt`, `options?`): `Promise`\<`AsyncIterable`\<[`StreamingResponseChunk`](StreamingResponseChunk), `any`, `any`\>\>

Execute AI conversation with streaming response

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `prompt` | `string` | User input text |
| `options?` | [`RunOptions`](RunOptions) | Optional run configuration |

#### Returns

`Promise`\<`AsyncIterable`\<[`StreamingResponseChunk`](StreamingResponseChunk), `any`, `any`\>\>

Promise resolving to async iterable of response chunks

#### Defined in

[packages/core/src/interfaces/robota-core.ts:27](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/core/src/interfaces/robota-core.ts#L27)

___

### close

▸ **close**(): `Promise`\<`void`\>

Release all resources and close connections

#### Returns

`Promise`\<`void`\>

Promise that resolves when cleanup is complete

#### Defined in

[packages/core/src/interfaces/robota-core.ts:34](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/core/src/interfaces/robota-core.ts#L34)
