[Core API](../../) / [Exports](../modules) / MCPClient

# Interface: MCPClient

MCP 클라이언트 인터페이스

## Table of contents

### Properties

- [callTool](MCPClient#calltool)
- [chat](MCPClient#chat)
- [close](MCPClient#close)
- [connect](MCPClient#connect)
- [getResource](MCPClient#getresource)
- [listTools](MCPClient#listtools)
- [stream](MCPClient#stream)

## Properties

### callTool

• **callTool**: (`params`: \{ `arguments`: `any` ; `name`: `string`  }) => `Promise`\<`any`\>

#### Type declaration

▸ (`params`): `Promise`\<`any`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `params` | `Object` |
| `params.arguments` | `any` |
| `params.name` | `string` |

##### Returns

`Promise`\<`any`\>

#### Defined in

[packages/core/src/types.ts:139](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L139)

___

### chat

• **chat**: (`options`: `any`) => `Promise`\<`any`\>

#### Type declaration

▸ (`options`): `Promise`\<`any`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `any` |

##### Returns

`Promise`\<`any`\>

#### Defined in

[packages/core/src/types.ts:136](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L136)

___

### close

• `Optional` **close**: () => `Promise`\<`void`\>

#### Type declaration

▸ (): `Promise`\<`void`\>

##### Returns

`Promise`\<`void`\>

#### Defined in

[packages/core/src/types.ts:141](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L141)

___

### connect

• **connect**: (`transport`: `any`) => `Promise`\<`void`\>

#### Type declaration

▸ (`transport`): `Promise`\<`void`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `transport` | `any` |

##### Returns

`Promise`\<`void`\>

#### Defined in

[packages/core/src/types.ts:135](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L135)

___

### getResource

• `Optional` **getResource**: (`uri`: `string`) => `Promise`\<`any`\>

#### Type declaration

▸ (`uri`): `Promise`\<`any`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `uri` | `string` |

##### Returns

`Promise`\<`any`\>

#### Defined in

[packages/core/src/types.ts:140](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L140)

___

### listTools

• **listTools**: () => `Promise`\<\{ `tools`: `any`[]  }\>

#### Type declaration

▸ (): `Promise`\<\{ `tools`: `any`[]  }\>

##### Returns

`Promise`\<\{ `tools`: `any`[]  }\>

#### Defined in

[packages/core/src/types.ts:138](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L138)

___

### stream

• `Optional` **stream**: (`options`: `any`) => `AsyncIterable`\<`any`, `any`, `any`\>

#### Type declaration

▸ (`options`): `AsyncIterable`\<`any`, `any`, `any`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `any` |

##### Returns

`AsyncIterable`\<`any`, `any`, `any`\>

#### Defined in

[packages/core/src/types.ts:137](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L137)
