<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[Core API](../../) / [Exports](../modules) / FunctionCallManager

# Class: FunctionCallManager

Function call management class
Manages function call settings and modes.

## Table of contents

### Constructors

- [constructor](FunctionCallManager#constructor)

### Methods

- [configure](FunctionCallManager#configure)
- [getAllowedFunctions](FunctionCallManager#getallowedfunctions)
- [getConfig](FunctionCallManager#getconfig)
- [getDefaultMode](FunctionCallManager#getdefaultmode)
- [getMaxCalls](FunctionCallManager#getmaxcalls)
- [getTimeout](FunctionCallManager#gettimeout)
- [isFunctionAllowed](FunctionCallManager#isfunctionallowed)
- [setFunctionCallMode](FunctionCallManager#setfunctioncallmode)

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

[core/src/managers/function-call-manager.ts:28](https://github.com/woojubb/robota/blob/b0cf7aa96e615a2c6055b8b6239ad3905ce992d6/packages/core/src/managers/function-call-manager.ts#L28)

## Methods

### configure

▸ **configure**(`config`): `void`

Configure function call settings

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `config` | `Object` | Function call configuration options |
| `config.allowedFunctions?` | `string`[] | - |
| `config.maxCalls?` | `number` | - |
| `config.mode?` | [`FunctionCallMode`](../modules#functioncallmode) | - |
| `config.timeout?` | `number` | - |

#### Returns

`void`

#### Defined in

[core/src/managers/function-call-manager.ts:51](https://github.com/woojubb/robota/blob/b0cf7aa96e615a2c6055b8b6239ad3905ce992d6/packages/core/src/managers/function-call-manager.ts#L51)

___

### getAllowedFunctions

▸ **getAllowedFunctions**(): `undefined` \| `string`[]

Get allowed functions list

#### Returns

`undefined` \| `string`[]

#### Defined in

[core/src/managers/function-call-manager.ts:95](https://github.com/woojubb/robota/blob/b0cf7aa96e615a2c6055b8b6239ad3905ce992d6/packages/core/src/managers/function-call-manager.ts#L95)

___

### getConfig

▸ **getConfig**(): [`FunctionCallConfig`](../interfaces/FunctionCallConfig)

Get complete configuration

#### Returns

[`FunctionCallConfig`](../interfaces/FunctionCallConfig)

#### Defined in

[core/src/managers/function-call-manager.ts:102](https://github.com/woojubb/robota/blob/b0cf7aa96e615a2c6055b8b6239ad3905ce992d6/packages/core/src/managers/function-call-manager.ts#L102)

___

### getDefaultMode

▸ **getDefaultMode**(): [`FunctionCallMode`](../modules#functioncallmode)

Get current function call mode

#### Returns

[`FunctionCallMode`](../modules#functioncallmode)

#### Defined in

[core/src/managers/function-call-manager.ts:74](https://github.com/woojubb/robota/blob/b0cf7aa96e615a2c6055b8b6239ad3905ce992d6/packages/core/src/managers/function-call-manager.ts#L74)

___

### getMaxCalls

▸ **getMaxCalls**(): `number`

Get maximum call count

#### Returns

`number`

#### Defined in

[core/src/managers/function-call-manager.ts:81](https://github.com/woojubb/robota/blob/b0cf7aa96e615a2c6055b8b6239ad3905ce992d6/packages/core/src/managers/function-call-manager.ts#L81)

___

### getTimeout

▸ **getTimeout**(): `number`

Get timeout setting

#### Returns

`number`

#### Defined in

[core/src/managers/function-call-manager.ts:88](https://github.com/woojubb/robota/blob/b0cf7aa96e615a2c6055b8b6239ad3905ce992d6/packages/core/src/managers/function-call-manager.ts#L88)

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

[core/src/managers/function-call-manager.ts:111](https://github.com/woojubb/robota/blob/b0cf7aa96e615a2c6055b8b6239ad3905ce992d6/packages/core/src/managers/function-call-manager.ts#L111)

___

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

[core/src/managers/function-call-manager.ts:42](https://github.com/woojubb/robota/blob/b0cf7aa96e615a2c6055b8b6239ad3905ce992d6/packages/core/src/managers/function-call-manager.ts#L42)
