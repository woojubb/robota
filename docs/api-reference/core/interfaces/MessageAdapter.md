[Core API](../../) / [Exports](../modules) / MessageAdapter

# Interface: MessageAdapter\<T\>

Message conversion interface that AI Provider adapters should implement

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |

## Table of contents

### Methods

- [convertFromUniversal](MessageAdapter#convertfromuniversal)
- [convertFromUniversalMessages](MessageAdapter#convertfromuniversalmessages)

## Methods

### convertFromUniversal

▸ **convertFromUniversal**(`universalMessage`): `T`

Convert UniversalMessage to specific AI Provider format

#### Parameters

| Name | Type |
| :------ | :------ |
| `universalMessage` | [`UniversalMessage`](UniversalMessage) |

#### Returns

`T`

#### Defined in

[core/src/utils.ts:188](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/utils.ts#L188)

___

### convertFromUniversalMessages

▸ **convertFromUniversalMessages**(`universalMessages`): `T`[]

Convert UniversalMessage array to specific AI Provider format array

#### Parameters

| Name | Type |
| :------ | :------ |
| `universalMessages` | [`UniversalMessage`](UniversalMessage)[] |

#### Returns

`T`[]

#### Defined in

[core/src/utils.ts:193](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/utils.ts#L193)
