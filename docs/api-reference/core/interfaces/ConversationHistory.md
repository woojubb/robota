<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[core](../../) / [Exports](../modules) / ConversationHistory

# Interface: ConversationHistory

Interface for managing conversation history

This interface provides methods for adding, retrieving, and managing
messages in a conversation thread. Implementations may provide
different storage mechanisms, message limits, or special handling
for specific message types.

## Table of contents

### Methods

- [addMessage](ConversationHistory#addmessage)
- [addUserMessage](ConversationHistory#addusermessage)
- [addAssistantMessage](ConversationHistory#addassistantmessage)
- [addSystemMessage](ConversationHistory#addsystemmessage)
- [addToolMessage](ConversationHistory#addtoolmessage)
- [getMessages](ConversationHistory#getmessages)
- [getMessagesByRole](ConversationHistory#getmessagesbyrole)
- [getRecentMessages](ConversationHistory#getrecentmessages)
- [clear](ConversationHistory#clear)
- [getMessageCount](ConversationHistory#getmessagecount)

## Methods

### addMessage

▸ **addMessage**(`message`): `void`

Add a message to conversation history

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`UniversalMessage`](../modules#universalmessage) | Universal message to add |

#### Returns

`void`

#### Defined in

[conversation-history.ts:278](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L278)

___

### addUserMessage

▸ **addUserMessage**(`content`, `metadata?`): `void`

Add user message (convenience method)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `content` | `string` | User message content |
| `metadata?` | `Record`\<`string`, `any`\> | Optional metadata |

#### Returns

`void`

#### Defined in

[conversation-history.ts:286](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L286)

___

### addAssistantMessage

▸ **addAssistantMessage**(`content`, `functionCall?`, `metadata?`): `void`

Add assistant message (convenience method)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `content` | `string` | Assistant response content |
| `functionCall?` | `FunctionCall` | Optional function call made by assistant |
| `metadata?` | `Record`\<`string`, `any`\> | Optional metadata |

#### Returns

`void`

#### Defined in

[conversation-history.ts:295](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L295)

___

### addSystemMessage

▸ **addSystemMessage**(`content`, `metadata?`): `void`

Add system message (convenience method)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `content` | `string` | System instruction content |
| `metadata?` | `Record`\<`string`, `any`\> | Optional metadata |

#### Returns

`void`

#### Defined in

[conversation-history.ts:303](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L303)

___

### addToolMessage

▸ **addToolMessage**(`toolResult`, `metadata?`): `void`

Add tool execution result message (convenience method)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `toolResult` | `FunctionCallResult` | Tool execution result |
| `metadata?` | `Record`\<`string`, `any`\> | Optional metadata |

#### Returns

`void`

#### Defined in

[conversation-history.ts:311](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L311)

___

### getMessages

▸ **getMessages**(): [`UniversalMessage`](../modules#universalmessage)[]

Get all messages in chronological order

#### Returns

[`UniversalMessage`](../modules#universalmessage)[]

Array of all messages

#### Defined in

[conversation-history.ts:318](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L318)

___

### getMessagesByRole

▸ **getMessagesByRole**(`role`): [`UniversalMessage`](../modules#universalmessage)[]

Get messages filtered by specific role

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `role` | [`UniversalMessageRole`](../modules#universalmessagerole) | Message role to filter by |

#### Returns

[`UniversalMessage`](../modules#universalmessage)[]

Array of messages with the specified role

#### Defined in

[conversation-history.ts:326](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L326)

___

### getRecentMessages

▸ **getRecentMessages**(`count`): [`UniversalMessage`](../modules#universalmessage)[]

Get the most recent n messages

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `count` | `number` | Number of recent messages to return |

#### Returns

[`UniversalMessage`](../modules#universalmessage)[]

Array of recent messages

#### Defined in

[conversation-history.ts:334](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L334)

___

### clear

▸ **clear**(): `void`

Clear all conversation history

#### Returns

`void`

#### Defined in

[conversation-history.ts:339](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L339)

___

### getMessageCount

▸ **getMessageCount**(): `number`

Get total message count

#### Returns

`number`

Number of messages in history

#### Defined in

[conversation-history.ts:346](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L346)
