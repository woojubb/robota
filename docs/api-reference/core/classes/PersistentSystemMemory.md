[Core API](../../) / [Exports](../modules) / PersistentSystemMemory

# Class: PersistentSystemMemory

시스템 메시지를 유지하는 메모리

## Implements

- [`Memory`](../interfaces/Memory)

## Table of contents

### Constructors

- [constructor](PersistentSystemMemory#constructor)

### Methods

- [addMessage](PersistentSystemMemory#addmessage)
- [clear](PersistentSystemMemory#clear)
- [getMessages](PersistentSystemMemory#getmessages)
- [updateSystemPrompt](PersistentSystemMemory#updatesystemprompt)

## Constructors

### constructor

• **new PersistentSystemMemory**(`systemPrompt`, `options?`): [`PersistentSystemMemory`](PersistentSystemMemory)

#### Parameters

| Name | Type |
| :------ | :------ |
| `systemPrompt` | `string` |
| `options?` | `Object` |
| `options.maxMessages?` | `number` |

#### Returns

[`PersistentSystemMemory`](PersistentSystemMemory)

#### Defined in

[packages/core/src/memory.ts:74](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/memory.ts#L74)

## Methods

### addMessage

▸ **addMessage**(`message`): `void`

메모리에 메시지를 추가합니다.

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | [`Message`](../interfaces/Message) |

#### Returns

`void`

#### Implementation of

[Memory](../interfaces/Memory).[addMessage](../interfaces/Memory#addmessage)

#### Defined in

[packages/core/src/memory.ts:85](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/memory.ts#L85)

___

### clear

▸ **clear**(): `void`

저장된 메시지를 지웁니다.

#### Returns

`void`

#### Implementation of

[Memory](../interfaces/Memory).[clear](../interfaces/Memory#clear)

#### Defined in

[packages/core/src/memory.ts:93](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/memory.ts#L93)

___

### getMessages

▸ **getMessages**(): [`Message`](../interfaces/Message)[]

저장된 모든 메시지를 가져옵니다.

#### Returns

[`Message`](../interfaces/Message)[]

#### Implementation of

[Memory](../interfaces/Memory).[getMessages](../interfaces/Memory#getmessages)

#### Defined in

[packages/core/src/memory.ts:89](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/memory.ts#L89)

___

### updateSystemPrompt

▸ **updateSystemPrompt**(`systemPrompt`): `void`

시스템 프롬프트 업데이트

#### Parameters

| Name | Type |
| :------ | :------ |
| `systemPrompt` | `string` |

#### Returns

`void`

#### Defined in

[packages/core/src/memory.ts:106](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/memory.ts#L106)
