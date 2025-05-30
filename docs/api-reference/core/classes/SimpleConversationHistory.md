<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[core](../../) / [Exports](../modules) / SimpleConversationHistory

# Class: SimpleConversationHistory

Default conversation history implementation

## Implements

- [`ConversationHistory`](../interfaces/ConversationHistory)

## Table of contents

### Constructors

- [constructor](SimpleConversationHistory#constructor)

### Methods

- [addMessage](SimpleConversationHistory#addmessage)
- [addUserMessage](SimpleConversationHistory#addusermessage)
- [addAssistantMessage](SimpleConversationHistory#addassistantmessage)
- [addSystemMessage](SimpleConversationHistory#addsystemmessage)
- [addToolMessage](SimpleConversationHistory#addtoolmessage)
- [getMessages](SimpleConversationHistory#getmessages)
- [getMessagesByRole](SimpleConversationHistory#getmessagesbyrole)
- [getRecentMessages](SimpleConversationHistory#getrecentmessages)
- [getMessageCount](SimpleConversationHistory#getmessagecount)
- [clear](SimpleConversationHistory#clear)

## Constructors

### constructor

• **new SimpleConversationHistory**(`options?`): [`SimpleConversationHistory`](SimpleConversationHistory)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options?` | `Object` |
| `options.maxMessages?` | `number` |

#### Returns

[`SimpleConversationHistory`](SimpleConversationHistory)

#### Defined in

[conversation-history.ts:98](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/core/src/conversation-history.ts#L98)

## Methods

### addMessage

▸ **addMessage**(`message`): `void`

Add message to conversation history

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | [`UniversalMessage`](../interfaces/UniversalMessage) |

#### Returns

`void`

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[addMessage](../interfaces/ConversationHistory#addmessage)

#### Defined in

[conversation-history.ts:102](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/core/src/conversation-history.ts#L102)

___

### addUserMessage

▸ **addUserMessage**(`content`, `metadata?`): `void`

Add user message (convenience method)

#### Parameters

| Name | Type |
| :------ | :------ |
| `content` | `string` |
| `metadata?` | `Record`\<`string`, `any`\> |

#### Returns

`void`

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[addUserMessage](../interfaces/ConversationHistory#addusermessage)

#### Defined in

[conversation-history.ts:107](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/core/src/conversation-history.ts#L107)

___

### addAssistantMessage

▸ **addAssistantMessage**(`content`, `functionCall?`, `metadata?`): `void`

Add assistant message (convenience method)

#### Parameters

| Name | Type |
| :------ | :------ |
| `content` | `string` |
| `functionCall?` | `FunctionCall` |
| `metadata?` | `Record`\<`string`, `any`\> |

#### Returns

`void`

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[addAssistantMessage](../interfaces/ConversationHistory#addassistantmessage)

#### Defined in

[conversation-history.ts:116](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/core/src/conversation-history.ts#L116)

___

### addSystemMessage

▸ **addSystemMessage**(`content`, `metadata?`): `void`

Add system message (convenience method)

#### Parameters

| Name | Type |
| :------ | :------ |
| `content` | `string` |
| `metadata?` | `Record`\<`string`, `any`\> |

#### Returns

`void`

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[addSystemMessage](../interfaces/ConversationHistory#addsystemmessage)

#### Defined in

[conversation-history.ts:126](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/core/src/conversation-history.ts#L126)

___

### addToolMessage

▸ **addToolMessage**(`toolResult`, `metadata?`): `void`

Add tool execution result message (convenience method)

#### Parameters

| Name | Type |
| :------ | :------ |
| `toolResult` | `FunctionCallResult` |
| `metadata?` | `Record`\<`string`, `any`\> |

#### Returns

`void`

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[addToolMessage](../interfaces/ConversationHistory#addtoolmessage)

#### Defined in

[conversation-history.ts:135](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/core/src/conversation-history.ts#L135)

___

### getMessages

▸ **getMessages**(): [`UniversalMessage`](../interfaces/UniversalMessage)[]

Get all messages

#### Returns

[`UniversalMessage`](../interfaces/UniversalMessage)[]

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[getMessages](../interfaces/ConversationHistory#getmessages)

#### Defined in

[conversation-history.ts:150](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/core/src/conversation-history.ts#L150)

___

### getMessagesByRole

▸ **getMessagesByRole**(`role`): [`UniversalMessage`](../interfaces/UniversalMessage)[]

Get messages by specific role

#### Parameters

| Name | Type |
| :------ | :------ |
| `role` | [`UniversalMessageRole`](../modules#universalmessagerole) |

#### Returns

[`UniversalMessage`](../interfaces/UniversalMessage)[]

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[getMessagesByRole](../interfaces/ConversationHistory#getmessagesbyrole)

#### Defined in

[conversation-history.ts:154](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/core/src/conversation-history.ts#L154)

___

### getRecentMessages

▸ **getRecentMessages**(`count`): [`UniversalMessage`](../interfaces/UniversalMessage)[]

Get recent n messages

#### Parameters

| Name | Type |
| :------ | :------ |
| `count` | `number` |

#### Returns

[`UniversalMessage`](../interfaces/UniversalMessage)[]

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[getRecentMessages](../interfaces/ConversationHistory#getrecentmessages)

#### Defined in

[conversation-history.ts:158](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/core/src/conversation-history.ts#L158)

___

### getMessageCount

▸ **getMessageCount**(): `number`

Return message count

#### Returns

`number`

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[getMessageCount](../interfaces/ConversationHistory#getmessagecount)

#### Defined in

[conversation-history.ts:162](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/core/src/conversation-history.ts#L162)

___

### clear

▸ **clear**(): `void`

Clear conversation history

#### Returns

`void`

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[clear](../interfaces/ConversationHistory#clear)

#### Defined in

[conversation-history.ts:166](https://github.com/woojubb/robota/blob/1932a2ce46e4833a6ba7efc7b507276de39139b4/packages/core/src/conversation-history.ts#L166)
