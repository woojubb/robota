[Core API](../../) / [Exports](../modules) / RobotaOptions

# Interface: RobotaOptions

Robota 설정 인터페이스

## Table of contents

### Properties

- [aiClient](RobotaOptions#aiclient)
- [functionCallConfig](RobotaOptions#functioncallconfig)
- [mcpClient](RobotaOptions#mcpclient)
- [memory](RobotaOptions#memory)
- [model](RobotaOptions#model)
- [onFunctionCall](RobotaOptions#onfunctioncall)
- [onToolCall](RobotaOptions#ontoolcall)
- [provider](RobotaOptions#provider)
- [systemMessages](RobotaOptions#systemmessages)
- [systemPrompt](RobotaOptions#systemprompt)
- [temperature](RobotaOptions#temperature)

## Properties

### aiClient

• `Optional` **aiClient**: [`AIClient`](AIClient)

#### Defined in

[packages/core/src/types.ts:163](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L163)

___

### functionCallConfig

• `Optional` **functionCallConfig**: [`FunctionCallConfig`](FunctionCallConfig)

#### Defined in

[packages/core/src/types.ts:169](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L169)

___

### mcpClient

• `Optional` **mcpClient**: [`MCPClient`](MCPClient)

#### Defined in

[packages/core/src/types.ts:162](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L162)

___

### memory

• `Optional` **memory**: `any`

#### Defined in

[packages/core/src/types.ts:168](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L168)

___

### model

• `Optional` **model**: `string`

#### Defined in

[packages/core/src/types.ts:164](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L164)

___

### onFunctionCall

• `Optional` **onFunctionCall**: (`functionName`: `string`, `args`: `any`, `result`: `any`) => `void`

#### Type declaration

▸ (`functionName`, `args`, `result`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `functionName` | `string` |
| `args` | `any` |
| `result` | `any` |

##### Returns

`void`

#### Defined in

[packages/core/src/types.ts:170](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L170)

___

### onToolCall

• `Optional` **onToolCall**: (`toolName`: `string`, `params`: `any`, `result`: `any`) => `void`

#### Type declaration

▸ (`toolName`, `params`, `result`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `toolName` | `string` |
| `params` | `any` |
| `result` | `any` |

##### Returns

`void`

#### Defined in

[packages/core/src/types.ts:171](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L171)

___

### provider

• `Optional` **provider**: `any`

#### Defined in

[packages/core/src/types.ts:161](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L161)

___

### systemMessages

• `Optional` **systemMessages**: [`Message`](Message)[]

#### Defined in

[packages/core/src/types.ts:167](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L167)

___

### systemPrompt

• `Optional` **systemPrompt**: `string`

#### Defined in

[packages/core/src/types.ts:166](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L166)

___

### temperature

• `Optional` **temperature**: `number`

#### Defined in

[packages/core/src/types.ts:165](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L165)
