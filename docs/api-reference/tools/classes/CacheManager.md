<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[tools](../../) / [Exports](../modules) / CacheManager

# Class: CacheManager\<T\>

Cache manager class

Supports LRU (Least Recently Used) algorithm and TTL (Time To Live).

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |

## Hierarchy

- **`CacheManager`**

  ↳ [`FunctionSchemaCacheManager`](FunctionSchemaCacheManager)

## Table of contents

### Constructors

- [constructor](CacheManager#constructor)

### Methods

- [get](CacheManager#get)
- [set](CacheManager#set)
- [delete](CacheManager#delete)
- [has](CacheManager#has)
- [clear](CacheManager#clear)
- [cleanup](CacheManager#cleanup)
- [getStats](CacheManager#getstats)
- [keys](CacheManager#keys)
- [values](CacheManager#values)
- [size](CacheManager#size)

## Constructors

### constructor

• **new CacheManager**\<`T`\>(`options?`): [`CacheManager`](CacheManager)\<`T`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `Object` |
| `options.maxSize?` | `number` |
| `options.defaultTTL?` | `number` |

#### Returns

[`CacheManager`](CacheManager)\<`T`\>

#### Defined in

[packages/tools/src/performance/cache-manager.ts:58](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/performance/cache-manager.ts#L58)

## Methods

### get

▸ **get**(`key`): `undefined` \| `T`

Get value from cache

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`undefined` \| `T`

#### Defined in

[packages/tools/src/performance/cache-manager.ts:69](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/performance/cache-manager.ts#L69)

___

### set

▸ **set**(`key`, `value`, `ttl?`): `void`

Set value in cache

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `value` | `T` |
| `ttl?` | `number` |

#### Returns

`void`

#### Defined in

[packages/tools/src/performance/cache-manager.ts:96](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/performance/cache-manager.ts#L96)

___

### delete

▸ **delete**(`key`): `boolean`

Delete item from cache

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

#### Defined in

[packages/tools/src/performance/cache-manager.ts:117](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/performance/cache-manager.ts#L117)

___

### has

▸ **has**(`key`): `boolean`

Check if specific key exists in cache

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

#### Defined in

[packages/tools/src/performance/cache-manager.ts:124](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/performance/cache-manager.ts#L124)

___

### clear

▸ **clear**(): `void`

Clear entire cache

#### Returns

`void`

#### Defined in

[packages/tools/src/performance/cache-manager.ts:140](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/performance/cache-manager.ts#L140)

___

### cleanup

▸ **cleanup**(): `number`

Clean up expired items

#### Returns

`number`

#### Defined in

[packages/tools/src/performance/cache-manager.ts:150](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/performance/cache-manager.ts#L150)

___

### getStats

▸ **getStats**(): [`CacheStats`](../interfaces/CacheStats)

Get cache statistics

#### Returns

[`CacheStats`](../interfaces/CacheStats)

#### Defined in

[packages/tools/src/performance/cache-manager.ts:168](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/performance/cache-manager.ts#L168)

___

### keys

▸ **keys**(): `string`[]

Get all cache keys

#### Returns

`string`[]

#### Defined in

[packages/tools/src/performance/cache-manager.ts:192](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/performance/cache-manager.ts#L192)

___

### values

▸ **values**(): `T`[]

Get all cache values

#### Returns

`T`[]

#### Defined in

[packages/tools/src/performance/cache-manager.ts:199](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/performance/cache-manager.ts#L199)

___

### size

▸ **size**(): `number`

Get cache size

#### Returns

`number`

#### Defined in

[packages/tools/src/performance/cache-manager.ts:206](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/performance/cache-manager.ts#L206)
