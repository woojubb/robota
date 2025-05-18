[Core API](../../) / [Exports](../modules) / FunctionRegistry

# Class: FunctionRegistry

함수 호출 레지스트리

## Table of contents

### Constructors

- [constructor](FunctionRegistry#constructor)

### Methods

- [execute](FunctionRegistry#execute)
- [getAllDefinitions](FunctionRegistry#getalldefinitions)
- [getDefinition](FunctionRegistry#getdefinition)
- [register](FunctionRegistry#register)

## Constructors

### constructor

• **new FunctionRegistry**(): [`FunctionRegistry`](FunctionRegistry)

#### Returns

[`FunctionRegistry`](FunctionRegistry)

## Methods

### execute

▸ **execute**(`functionCall`, `context?`): `Promise`\<[`FunctionCallResult`](../interfaces/FunctionCallResult)\>

함수 호출을 실행합니다

#### Parameters

| Name | Type |
| :------ | :------ |
| `functionCall` | [`FunctionCall`](../interfaces/FunctionCall) |
| `context?` | `any` |

#### Returns

`Promise`\<[`FunctionCallResult`](../interfaces/FunctionCallResult)\>

#### Defined in

[packages/core/src/function-calling.ts:77](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/function-calling.ts#L77)

___

### getAllDefinitions

▸ **getAllDefinitions**(): [`FunctionDefinition`](../interfaces/FunctionDefinition)[]

등록된 모든 함수 정의를 반환합니다

#### Returns

[`FunctionDefinition`](../interfaces/FunctionDefinition)[]

#### Defined in

[packages/core/src/function-calling.ts:63](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/function-calling.ts#L63)

___

### getDefinition

▸ **getDefinition**(`name`): `undefined` \| [`FunctionDefinition`](../interfaces/FunctionDefinition)

함수 이름으로 함수 정의를 가져옵니다

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`undefined` \| [`FunctionDefinition`](../interfaces/FunctionDefinition)

#### Defined in

[packages/core/src/function-calling.ts:70](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/function-calling.ts#L70)

___

### register

▸ **register**(`definition`, `handler`): `void`

함수를 등록합니다

#### Parameters

| Name | Type |
| :------ | :------ |
| `definition` | [`FunctionDefinition`](../interfaces/FunctionDefinition) |
| `handler` | [`FunctionHandler`](../modules#functionhandler) |

#### Returns

`void`

#### Defined in

[packages/core/src/function-calling.ts:55](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/function-calling.ts#L55)
