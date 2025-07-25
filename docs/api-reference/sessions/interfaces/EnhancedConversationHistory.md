<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[sessions](../../) / [Exports](../modules) / EnhancedConversationHistory

# Interface: EnhancedConversationHistory

Enhanced conversation history with configuration tracking

## Hierarchy

- [`ConversationHistory`](../classes/ConversationHistory)

  ↳ **`EnhancedConversationHistory`**

## Table of contents

### Properties

- [configurations](EnhancedConversationHistory#configurations)

### Methods

- [getConversationSession](EnhancedConversationHistory#getconversationsession)
- [hasConversation](EnhancedConversationHistory#hasconversation)
- [removeConversation](EnhancedConversationHistory#removeconversation)
- [clearAll](EnhancedConversationHistory#clearall)
- [getStats](EnhancedConversationHistory#getstats)
- [addConfigurationChange](EnhancedConversationHistory#addconfigurationchange)
- [getConfigurationHistory](EnhancedConversationHistory#getconfigurationhistory)
- [clearConfigurationHistory](EnhancedConversationHistory#clearconfigurationhistory)
- [updateMessage](EnhancedConversationHistory#updatemessage)
- [removeMessage](EnhancedConversationHistory#removemessage)
- [getConfigurationChangeCount](EnhancedConversationHistory#getconfigurationchangecount)
- [export](EnhancedConversationHistory#export)
- [import](EnhancedConversationHistory#import)
- [getMemoryUsage](EnhancedConversationHistory#getmemoryusage)

## Properties

### configurations

• **configurations**: [`ConfigurationChange`](ConfigurationChange)[]

#### Defined in

[sessions/src/types/chat.ts:67](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/types/chat.ts#L67)

## Methods

### getConversationSession

▸ **getConversationSession**(`conversationId`): [`ConversationSession`](../classes/ConversationSession)

Get or create a conversation session

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `conversationId` | `string` | Unique conversation identifier |

#### Returns

[`ConversationSession`](../classes/ConversationSession)

ConversationSession instance

#### Inherited from

[ConversationHistory](../classes/ConversationHistory).[getConversationSession](../classes/ConversationHistory#getconversationsession)

#### Defined in

agents/dist/index.d.ts:388

___

### hasConversation

▸ **hasConversation**(`conversationId`): `boolean`

Check if a conversation exists

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `conversationId` | `string` | Conversation identifier to check |

#### Returns

`boolean`

True if conversation exists

#### Inherited from

[ConversationHistory](../classes/ConversationHistory).[hasConversation](../classes/ConversationHistory#hasconversation)

#### Defined in

agents/dist/index.d.ts:395

___

### removeConversation

▸ **removeConversation**(`conversationId`): `boolean`

Remove a specific conversation

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `conversationId` | `string` | Conversation identifier to remove |

#### Returns

`boolean`

True if conversation was removed, false if not found

#### Inherited from

[ConversationHistory](../classes/ConversationHistory).[removeConversation](../classes/ConversationHistory#removeconversation)

#### Defined in

agents/dist/index.d.ts:402

___

### clearAll

▸ **clearAll**(): `void`

Clear all conversations

#### Returns

`void`

#### Inherited from

[ConversationHistory](../classes/ConversationHistory).[clearAll](../classes/ConversationHistory#clearall)

#### Defined in

agents/dist/index.d.ts:406

___

### getStats

▸ **getStats**(): `Object`

Get conversation statistics

#### Returns

`Object`

Statistics about managed conversations

| Name | Type |
| :------ | :------ |
| `totalConversations` | `number` |
| `conversationIds` | `string`[] |
| `totalMessages` | `number` |

#### Inherited from

[ConversationHistory](../classes/ConversationHistory).[getStats](../classes/ConversationHistory#getstats)

#### Defined in

agents/dist/index.d.ts:412

___

### addConfigurationChange

▸ **addConfigurationChange**(`change`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `change` | [`ConfigurationChange`](ConfigurationChange) |

#### Returns

`void`

#### Defined in

[sessions/src/types/chat.ts:68](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/types/chat.ts#L68)

___

### getConfigurationHistory

▸ **getConfigurationHistory**(): [`ConfigurationChange`](ConfigurationChange)[]

#### Returns

[`ConfigurationChange`](ConfigurationChange)[]

#### Defined in

[sessions/src/types/chat.ts:69](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/types/chat.ts#L69)

___

### clearConfigurationHistory

▸ **clearConfigurationHistory**(): `void`

#### Returns

`void`

#### Defined in

[sessions/src/types/chat.ts:70](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/types/chat.ts#L70)

___

### updateMessage

▸ **updateMessage**(`index`, `content`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `index` | `number` |
| `content` | `string` |

#### Returns

`boolean`

#### Defined in

[sessions/src/types/chat.ts:73](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/types/chat.ts#L73)

___

### removeMessage

▸ **removeMessage**(`index`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `index` | `number` |

#### Returns

`boolean`

#### Defined in

[sessions/src/types/chat.ts:74](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/types/chat.ts#L74)

___

### getConfigurationChangeCount

▸ **getConfigurationChangeCount**(): `number`

#### Returns

`number`

#### Defined in

[sessions/src/types/chat.ts:75](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/types/chat.ts#L75)

___

### export

▸ **export**(): `string`

#### Returns

`string`

#### Defined in

[sessions/src/types/chat.ts:78](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/types/chat.ts#L78)

___

### import

▸ **import**(`data`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `string` |

#### Returns

`void`

#### Defined in

[sessions/src/types/chat.ts:79](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/types/chat.ts#L79)

___

### getMemoryUsage

▸ **getMemoryUsage**(): `number`

#### Returns

`number`

#### Defined in

[sessions/src/types/chat.ts:82](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/sessions/src/types/chat.ts#L82)
