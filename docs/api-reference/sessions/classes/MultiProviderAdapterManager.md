<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[sessions](../../) / [Exports](../modules) / MultiProviderAdapterManager

# Class: MultiProviderAdapterManager

## Implements

- `ProviderManager`

## Table of contents

### Constructors

- [constructor](MultiProviderAdapterManager#constructor)

### Methods

- [addProvider](MultiProviderAdapterManager#addprovider)
- [getProvider](MultiProviderAdapterManager#getprovider)
- [removeProvider](MultiProviderAdapterManager#removeprovider)
- [listProviders](MultiProviderAdapterManager#listproviders)
- [setDefaultProvider](MultiProviderAdapterManager#setdefaultprovider)
- [getDefaultProvider](MultiProviderAdapterManager#getdefaultprovider)

## Constructors

### constructor

• **new MultiProviderAdapterManager**(): [`MultiProviderAdapterManager`](MultiProviderAdapterManager)

#### Returns

[`MultiProviderAdapterManager`](MultiProviderAdapterManager)

## Methods

### addProvider

▸ **addProvider**(`name`, `provider`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `provider` | `BaseAIProvider`\<`ProviderConfig`, `UniversalMessage`, `UniversalMessage`\> |

#### Returns

`void`

#### Implementation of

ProviderManager.addProvider

#### Defined in

[sessions/src/provider-adapter/multi-provider-adapter-manager.ts:19](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/provider-adapter/multi-provider-adapter-manager.ts#L19)

___

### getProvider

▸ **getProvider**(`name`): ``null`` \| `BaseAIProvider`\<`ProviderConfig`, `UniversalMessage`, `UniversalMessage`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

``null`` \| `BaseAIProvider`\<`ProviderConfig`, `UniversalMessage`, `UniversalMessage`\>

#### Implementation of

ProviderManager.getProvider

#### Defined in

[sessions/src/provider-adapter/multi-provider-adapter-manager.ts:23](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/provider-adapter/multi-provider-adapter-manager.ts#L23)

___

### removeProvider

▸ **removeProvider**(`name`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`boolean`

#### Implementation of

ProviderManager.removeProvider

#### Defined in

[sessions/src/provider-adapter/multi-provider-adapter-manager.ts:27](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/provider-adapter/multi-provider-adapter-manager.ts#L27)

___

### listProviders

▸ **listProviders**(): `string`[]

#### Returns

`string`[]

#### Implementation of

ProviderManager.listProviders

#### Defined in

[sessions/src/provider-adapter/multi-provider-adapter-manager.ts:31](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/provider-adapter/multi-provider-adapter-manager.ts#L31)

___

### setDefaultProvider

▸ **setDefaultProvider**(`name`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`void`

#### Implementation of

ProviderManager.setDefaultProvider

#### Defined in

[sessions/src/provider-adapter/multi-provider-adapter-manager.ts:35](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/provider-adapter/multi-provider-adapter-manager.ts#L35)

___

### getDefaultProvider

▸ **getDefaultProvider**(): ``null`` \| `string`

#### Returns

``null`` \| `string`

#### Implementation of

ProviderManager.getDefaultProvider

#### Defined in

[sessions/src/provider-adapter/multi-provider-adapter-manager.ts:41](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/provider-adapter/multi-provider-adapter-manager.ts#L41)
