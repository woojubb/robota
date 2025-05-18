[Core API](../../) / [Exports](../modules) / SimpleMemory

# Class: SimpleMemory

기본 인메모리 구현

## Implements

- [`Memory`](../interfaces/Memory)

## Table of contents

### Constructors

- [constructor](SimpleMemory#constructor)

### Methods

- [addMessage](SimpleMemory#addmessage)
- [clear](SimpleMemory#clear)
- [getMessages](SimpleMemory#getmessages)

## Constructors

### constructor

• **new SimpleMemory**(`options?`): [`SimpleMemory`](SimpleMemory)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options?` | `Object` |
| `options.maxMessages?` | `number` |

#### Returns

[`SimpleMemory`](SimpleMemory)

#### Defined in

[packages/core/src/memory.ts:36](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/memory.ts#L36)

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

[packages/core/src/memory.ts:40](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/memory.ts#L40)

___

### clear

▸ **clear**(): `void`

저장된 메시지를 지웁니다.

#### Returns

`void`

#### Implementation of

[Memory](../interfaces/Memory).[clear](../interfaces/Memory#clear)

#### Defined in

[packages/core/src/memory.ts:62](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/memory.ts#L62)

___

### getMessages

▸ **getMessages**(): [`Message`](../interfaces/Message)[]

저장된 모든 메시지를 가져옵니다.

#### Returns

[`Message`](../interfaces/Message)[]

#### Implementation of

[Memory](../interfaces/Memory).[getMessages](../interfaces/Memory#getmessages)

#### Defined in

[packages/core/src/memory.ts:58](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/memory.ts#L58)
