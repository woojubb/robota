[Core API](../../) / [Exports](../modules) / FunctionRegistry

# Class: FunctionRegistry

Function call registry

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

Execute function call

#### Parameters

| Name | Type |
| :------ | :------ |
| `functionCall` | [`FunctionCall`](../interfaces/FunctionCall) |
| `context?` | `any` |

#### Returns

`Promise`\<[`FunctionCallResult`](../interfaces/FunctionCallResult)\>

#### Defined in

tools/dist/index.d.ts:180

___

### getAllDefinitions

▸ **getAllDefinitions**(): [`FunctionDefinition`](../interfaces/FunctionDefinition)[]

Get all registered function definitions

#### Returns

[`FunctionDefinition`](../interfaces/FunctionDefinition)[]

#### Defined in

tools/dist/index.d.ts:172

___

### getDefinition

▸ **getDefinition**(`name`): `undefined` \| [`FunctionDefinition`](../interfaces/FunctionDefinition)

Get function definition by name

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`undefined` \| [`FunctionDefinition`](../interfaces/FunctionDefinition)

#### Defined in

tools/dist/index.d.ts:176

___

### register

▸ **register**(`definition`, `handler`): `void`

Register a function

#### Parameters

| Name | Type |
| :------ | :------ |
| `definition` | [`FunctionDefinition`](../interfaces/FunctionDefinition) |
| `handler` | [`FunctionHandler`](../modules#functionhandler) |

#### Returns

`void`

#### Defined in

tools/dist/index.d.ts:168
