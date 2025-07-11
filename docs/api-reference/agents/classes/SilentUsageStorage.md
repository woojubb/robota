<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[agents](../../) / [Exports](../modules) / SilentUsageStorage

# Class: SilentUsageStorage

Silent storage implementation for usage statistics (no-op)

## Implements

- [`UsageStorage`](../interfaces/UsageStorage)

## Table of contents

### Constructors

- [constructor](SilentUsageStorage#constructor)

### Methods

- [save](SilentUsageStorage#save)
- [getStats](SilentUsageStorage#getstats)
- [getAggregatedStats](SilentUsageStorage#getaggregatedstats)
- [clear](SilentUsageStorage#clear)
- [flush](SilentUsageStorage#flush)
- [close](SilentUsageStorage#close)

## Constructors

### constructor

• **new SilentUsageStorage**(): [`SilentUsageStorage`](SilentUsageStorage)

#### Returns

[`SilentUsageStorage`](SilentUsageStorage)

## Methods

### save

▸ **save**(`_entry`): `Promise`\<`void`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `_entry` | [`UsageStats`](../interfaces/UsageStats) |

#### Returns

`Promise`\<`void`\>

#### Implementation of

[UsageStorage](../interfaces/UsageStorage).[save](../interfaces/UsageStorage#save)

#### Defined in

[packages/agents/src/plugins/usage/storages/silent-storage.ts:7](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/usage/storages/silent-storage.ts#L7)

___

### getStats

▸ **getStats**(`_conversationId?`, `_timeRange?`): `Promise`\<[`UsageStats`](../interfaces/UsageStats)[]\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `_conversationId?` | `string` |
| `_timeRange?` | `Object` |
| `_timeRange.start` | `Date` |
| `_timeRange.end` | `Date` |

#### Returns

`Promise`\<[`UsageStats`](../interfaces/UsageStats)[]\>

#### Implementation of

[UsageStorage](../interfaces/UsageStorage).[getStats](../interfaces/UsageStorage#getstats)

#### Defined in

[packages/agents/src/plugins/usage/storages/silent-storage.ts:11](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/usage/storages/silent-storage.ts#L11)

___

### getAggregatedStats

▸ **getAggregatedStats**(`_timeRange?`): `Promise`\<[`AggregatedUsageStats`](../interfaces/AggregatedUsageStats)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `_timeRange?` | `Object` |
| `_timeRange.start` | `Date` |
| `_timeRange.end` | `Date` |

#### Returns

`Promise`\<[`AggregatedUsageStats`](../interfaces/AggregatedUsageStats)\>

#### Implementation of

[UsageStorage](../interfaces/UsageStorage).[getAggregatedStats](../interfaces/UsageStorage#getaggregatedstats)

#### Defined in

[packages/agents/src/plugins/usage/storages/silent-storage.ts:16](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/usage/storages/silent-storage.ts#L16)

___

### clear

▸ **clear**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

#### Implementation of

[UsageStorage](../interfaces/UsageStorage).[clear](../interfaces/UsageStorage#clear)

#### Defined in

[packages/agents/src/plugins/usage/storages/silent-storage.ts:35](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/usage/storages/silent-storage.ts#L35)

___

### flush

▸ **flush**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

#### Implementation of

[UsageStorage](../interfaces/UsageStorage).[flush](../interfaces/UsageStorage#flush)

#### Defined in

[packages/agents/src/plugins/usage/storages/silent-storage.ts:39](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/usage/storages/silent-storage.ts#L39)

___

### close

▸ **close**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

#### Implementation of

[UsageStorage](../interfaces/UsageStorage).[close](../interfaces/UsageStorage#close)

#### Defined in

[packages/agents/src/plugins/usage/storages/silent-storage.ts:43](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/usage/storages/silent-storage.ts#L43)
