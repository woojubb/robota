[Tools API](../../) / [Exports](../modules) / ToolRegistry

# Class: ToolRegistry

도구 레지스트리 클래스

여러 도구를 등록하고 관리하는 클래스

## Table of contents

### Constructors

- [constructor](ToolRegistry#constructor)

### Methods

- [executeTool](ToolRegistry#executetool)
- [getAllTools](ToolRegistry#getalltools)
- [getTool](ToolRegistry#gettool)
- [register](ToolRegistry#register)
- [registerMany](ToolRegistry#registermany)

## Constructors

### constructor

• **new ToolRegistry**(): [`ToolRegistry`](ToolRegistry)

#### Returns

[`ToolRegistry`](ToolRegistry)

## Methods

### executeTool

▸ **executeTool**\<`TInput`, `TOutput`\>(`name`, `input`): `Promise`\<[`ToolResult`](../interfaces/ToolResult)\<`TOutput`\>\>

도구 실행

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TInput` | `any` |
| `TOutput` | `any` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | 실행할 도구 이름 |
| `input` | `TInput` | 도구 입력 파라미터 |

#### Returns

`Promise`\<[`ToolResult`](../interfaces/ToolResult)\<`TOutput`\>\>

도구 실행 결과

#### Defined in

[index.ts:204](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L204)

___

### getAllTools

▸ **getAllTools**(): [`Tool`](../interfaces/Tool)\<`any`, `any`\>[]

모든 도구 가져오기

#### Returns

[`Tool`](../interfaces/Tool)\<`any`, `any`\>[]

모든 등록된 도구 배열

#### Defined in

[index.ts:193](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L193)

___

### getTool

▸ **getTool**(`name`): `undefined` \| [`Tool`](../interfaces/Tool)\<`any`, `any`\>

도구 가져오기

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | 가져올 도구 이름 |

#### Returns

`undefined` \| [`Tool`](../interfaces/Tool)\<`any`, `any`\>

도구 또는 undefined

#### Defined in

[index.ts:184](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L184)

___

### register

▸ **register**(`tool`): [`ToolRegistry`](ToolRegistry)

도구 등록

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `tool` | [`Tool`](../interfaces/Tool)\<`any`, `any`\> | 등록할 도구 |

#### Returns

[`ToolRegistry`](ToolRegistry)

#### Defined in

[index.ts:161](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L161)

___

### registerMany

▸ **registerMany**(`tools`): [`ToolRegistry`](ToolRegistry)

여러 도구 등록

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `tools` | [`Tool`](../interfaces/Tool)\<`any`, `any`\>[] | 등록할 도구 배열 |

#### Returns

[`ToolRegistry`](ToolRegistry)

#### Defined in

[index.ts:171](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L171)
