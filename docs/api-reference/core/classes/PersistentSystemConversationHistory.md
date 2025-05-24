[Core API](../../) / [Exports](../modules) / PersistentSystemConversationHistory

# Class: PersistentSystemConversationHistory

Conversation history implementation that maintains system messages

## Implements

- [`ConversationHistory`](../interfaces/ConversationHistory)

## Table of contents

### Constructors

- [constructor](PersistentSystemConversationHistory#constructor)

### Methods

- [addAssistantMessage](PersistentSystemConversationHistory#addassistantmessage)
- [addMessage](PersistentSystemConversationHistory#addmessage)
- [addSystemMessage](PersistentSystemConversationHistory#addsystemmessage)
- [addToolMessage](PersistentSystemConversationHistory#addtoolmessage)
- [addUserMessage](PersistentSystemConversationHistory#addusermessage)
- [clear](PersistentSystemConversationHistory#clear)
- [getMessageCount](PersistentSystemConversationHistory#getmessagecount)
- [getMessages](PersistentSystemConversationHistory#getmessages)
- [getMessagesByRole](PersistentSystemConversationHistory#getmessagesbyrole)
- [getRecentMessages](PersistentSystemConversationHistory#getrecentmessages)
- [getSystemPrompt](PersistentSystemConversationHistory#getsystemprompt)
- [updateSystemPrompt](PersistentSystemConversationHistory#updatesystemprompt)

## Constructors

### constructor

• **new PersistentSystemConversationHistory**(`systemPrompt`, `options?`): [`PersistentSystemConversationHistory`](PersistentSystemConversationHistory)

#### Parameters

| Name | Type |
| :------ | :------ |
| `systemPrompt` | `string` |
| `options?` | `Object` |
| `options.maxMessages?` | `number` |

#### Returns

[`PersistentSystemConversationHistory`](PersistentSystemConversationHistory)

#### Defined in

[core/src/conversation-history.ts:193](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/conversation-history.ts#L193)

## Methods

### addAssistantMessage

▸ **addAssistantMessage**(`content`, `functionCall?`, `metadata?`): `void`

Add assistant message (convenience method)

#### Parameters

| Name | Type |
| :------ | :------ |
| `content` | `string` |
| `functionCall?` | [`FunctionCall`](../interfaces/FunctionCall) |
| `metadata?` | `Record`\<`string`, `any`\> |

#### Returns

`void`

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[addAssistantMessage](../interfaces/ConversationHistory#addassistantmessage)

#### Defined in

[core/src/conversation-history.ts:209](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/conversation-history.ts#L209)

___

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

[core/src/conversation-history.ts:201](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/conversation-history.ts#L201)

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

[core/src/conversation-history.ts:213](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/conversation-history.ts#L213)

___

### addToolMessage

▸ **addToolMessage**(`toolResult`, `metadata?`): `void`

Add tool execution result message (convenience method)

#### Parameters

| Name | Type |
| :------ | :------ |
| `toolResult` | [`FunctionCallResult`](../interfaces/FunctionCallResult) |
| `metadata?` | `Record`\<`string`, `any`\> |

#### Returns

`void`

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[addToolMessage](../interfaces/ConversationHistory#addtoolmessage)

#### Defined in

[core/src/conversation-history.ts:217](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/conversation-history.ts#L217)

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

[core/src/conversation-history.ts:205](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/conversation-history.ts#L205)

___

### clear

▸ **clear**(): `void`

Clear conversation history

#### Returns

`void`

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[clear](../interfaces/ConversationHistory#clear)

#### Defined in

[core/src/conversation-history.ts:237](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/conversation-history.ts#L237)

___

### getMessageCount

▸ **getMessageCount**(): `number`

Return message count

#### Returns

`number`

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[getMessageCount](../interfaces/ConversationHistory#getmessagecount)

#### Defined in

[core/src/conversation-history.ts:233](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/conversation-history.ts#L233)

___

### getMessages

▸ **getMessages**(): [`UniversalMessage`](../interfaces/UniversalMessage)[]

Get all messages

#### Returns

[`UniversalMessage`](../interfaces/UniversalMessage)[]

#### Implementation of

[ConversationHistory](../interfaces/ConversationHistory).[getMessages](../interfaces/ConversationHistory#getmessages)

#### Defined in

[core/src/conversation-history.ts:221](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/conversation-history.ts#L221)

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

[core/src/conversation-history.ts:225](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/conversation-history.ts#L225)

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

[core/src/conversation-history.ts:229](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/conversation-history.ts#L229)

___

### getSystemPrompt

▸ **getSystemPrompt**(): `string`

Return current system prompt

#### Returns

`string`

#### Defined in

[core/src/conversation-history.ts:265](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/conversation-history.ts#L265)

___

### updateSystemPrompt

▸ **updateSystemPrompt**(`systemPrompt`): `void`

Update system prompt

#### Parameters

| Name | Type |
| :------ | :------ |
| `systemPrompt` | `string` |

#### Returns

`void`

#### Defined in

[core/src/conversation-history.ts:246](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/core/src/conversation-history.ts#L246)
