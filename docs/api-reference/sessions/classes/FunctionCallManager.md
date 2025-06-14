<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[sessions](../../) / [Exports](../modules) / FunctionCallManager

# Class: FunctionCallManager

Function call management class
Manages function call settings and modes.

## Table of contents

### Constructors

- [constructor](FunctionCallManager#constructor)

### Methods

- [setFunctionCallMode](FunctionCallManager#setfunctioncallmode)
- [configure](FunctionCallManager#configure)
- [getDefaultMode](FunctionCallManager#getdefaultmode)
- [getMaxCalls](FunctionCallManager#getmaxcalls)
- [getTimeout](FunctionCallManager#gettimeout)
- [getAllowedFunctions](FunctionCallManager#getallowedfunctions)
- [getConfig](FunctionCallManager#getconfig)
- [isFunctionAllowed](FunctionCallManager#isfunctionallowed)

## Constructors

### constructor

• **new FunctionCallManager**(`initialConfig?`): [`FunctionCallManager`](FunctionCallManager)

#### Parameters

| Name | Type |
| :------ | :------ |
| `initialConfig?` | [`FunctionCallConfig`](../interfaces/FunctionCallConfig) |

#### Returns

[`FunctionCallManager`](FunctionCallManager)

#### Defined in

packages/core/dist/index.d.ts:678

## Methods

### setFunctionCallMode

▸ **setFunctionCallMode**(`mode`): `void`

Set function call mode

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `mode` | [`FunctionCallMode`](../modules#functioncallmode) | Function call mode ('auto', 'force', 'disabled') |

#### Returns

`void`

#### Defined in

packages/core/dist/index.d.ts:684

___

### configure

▸ **configure**(`config`): `void`

Configure function call settings

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `config` | `Object` | Function call configuration options |
| `config.mode?` | [`FunctionCallMode`](../modules#functioncallmode) | - |
| `config.maxCalls?` | `number` | - |
| `config.timeout?` | `number` | - |
| `config.allowedFunctions?` | `string`[] | - |

#### Returns

`void`

#### Defined in

packages/core/dist/index.d.ts:690

___

### getDefaultMode

▸ **getDefaultMode**(): [`FunctionCallMode`](../modules#functioncallmode)

Get current function call mode

#### Returns

[`FunctionCallMode`](../modules#functioncallmode)

#### Defined in

packages/core/dist/index.d.ts:699

___

### getMaxCalls

▸ **getMaxCalls**(): `number`

Get maximum call count

#### Returns

`number`

#### Defined in

packages/core/dist/index.d.ts:703

___

### getTimeout

▸ **getTimeout**(): `number`

Get timeout setting

#### Returns

`number`

#### Defined in

packages/core/dist/index.d.ts:707

___

### getAllowedFunctions

▸ **getAllowedFunctions**(): `undefined` \| `string`[]

Get allowed functions list

#### Returns

`undefined` \| `string`[]

#### Defined in

packages/core/dist/index.d.ts:711

___

### getConfig

▸ **getConfig**(): [`FunctionCallConfig`](../interfaces/FunctionCallConfig)

Get complete configuration

#### Returns

[`FunctionCallConfig`](../interfaces/FunctionCallConfig)

#### Defined in

packages/core/dist/index.d.ts:715

___

### isFunctionAllowed

▸ **isFunctionAllowed**(`functionName`): `boolean`

Check if a specific function is allowed

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `functionName` | `string` | Function name to check |

#### Returns

`boolean`

#### Defined in

packages/core/dist/index.d.ts:721
