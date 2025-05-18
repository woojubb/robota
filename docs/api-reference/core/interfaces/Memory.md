[Core API](../../) / [Exports](../modules) / Memory

# Interface: Memory

메모리 인터페이스

메모리는 대화 이력을 저장하고 관리하는 역할을 합니다.

## Implemented by

- [`PersistentSystemMemory`](../classes/PersistentSystemMemory)
- [`SimpleMemory`](../classes/SimpleMemory)

## Table of contents

### Methods

- [addMessage](Memory#addmessage)
- [clear](Memory#clear)
- [getMessages](Memory#getmessages)

## Methods

### addMessage

▸ **addMessage**(`message`): `void`

메모리에 메시지를 추가합니다.

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | [`Message`](Message) |

#### Returns

`void`

#### Defined in

[packages/core/src/memory.ts:12](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/memory.ts#L12)

___

### clear

▸ **clear**(): `void`

저장된 메시지를 지웁니다.

#### Returns

`void`

#### Defined in

[packages/core/src/memory.ts:22](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/memory.ts#L22)

___

### getMessages

▸ **getMessages**(): [`Message`](Message)[]

저장된 모든 메시지를 가져옵니다.

#### Returns

[`Message`](Message)[]

#### Defined in

[packages/core/src/memory.ts:17](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/memory.ts#L17)
