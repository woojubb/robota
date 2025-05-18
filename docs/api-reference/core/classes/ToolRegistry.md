[Core API](../../) / [Exports](../modules) / ToolRegistry

# Class: ToolRegistry

도구 레지스트리

## Table of contents

### Constructors

- [constructor](ToolRegistry#constructor)

### Methods

- [execute](ToolRegistry#execute)
- [getFunctionDefinitions](ToolRegistry#getfunctiondefinitions)
- [getTool](ToolRegistry#gettool)
- [register](ToolRegistry#register)

## Constructors

### constructor

• **new ToolRegistry**(): [`ToolRegistry`](ToolRegistry)

#### Returns

[`ToolRegistry`](ToolRegistry)

## Methods

### execute

▸ **execute**(`name`, `args`): `Promise`\<`any`\>

도구 실행

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `args` | `Record`\<`string`, `any`\> |

#### Returns

`Promise`\<`any`\>

#### Defined in

[packages/core/src/tools.ts:142](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L142)

___

### getFunctionDefinitions

▸ **getFunctionDefinitions**(): [`FunctionDefinition`](../interfaces/FunctionDefinition)[]

모든 도구의 함수 정의 가져오기

#### Returns

[`FunctionDefinition`](../interfaces/FunctionDefinition)[]

#### Defined in

[packages/core/src/tools.ts:135](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L135)

___

### getTool

▸ **getTool**(`name`): `undefined` \| [`Tool`](../interfaces/Tool)

도구 이름으로 도구 가져오기

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`undefined` \| [`Tool`](../interfaces/Tool)

#### Defined in

[packages/core/src/tools.ts:128](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L128)

___

### register

▸ **register**(`tool`): `void`

도구 등록

#### Parameters

| Name | Type |
| :------ | :------ |
| `tool` | [`Tool`](../interfaces/Tool) |

#### Returns

`void`

#### Defined in

[packages/core/src/tools.ts:121](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/tools.ts#L121)
