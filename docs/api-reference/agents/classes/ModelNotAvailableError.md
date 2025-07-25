<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[agents](../../) / [Exports](../modules) / ModelNotAvailableError

# Class: ModelNotAvailableError

Model not available errors

## Hierarchy

- [`RobotaError`](RobotaError)

  ↳ **`ModelNotAvailableError`**

## Table of contents

### Constructors

- [constructor](ModelNotAvailableError#constructor)

### Properties

- [stackTraceLimit](ModelNotAvailableError#stacktracelimit)
- [cause](ModelNotAvailableError#cause)
- [name](ModelNotAvailableError#name)
- [message](ModelNotAvailableError#message)
- [stack](ModelNotAvailableError#stack)
- [context](ModelNotAvailableError#context)
- [code](ModelNotAvailableError#code)
- [category](ModelNotAvailableError#category)
- [recoverable](ModelNotAvailableError#recoverable)
- [availableModels](ModelNotAvailableError#availablemodels)

### Methods

- [captureStackTrace](ModelNotAvailableError#capturestacktrace)
- [prepareStackTrace](ModelNotAvailableError#preparestacktrace)

## Constructors

### constructor

• **new ModelNotAvailableError**(`model`, `provider`, `availableModels?`, `context?`): [`ModelNotAvailableError`](ModelNotAvailableError)

#### Parameters

| Name | Type |
| :------ | :------ |
| `model` | `string` |
| `provider` | `string` |
| `availableModels?` | `string`[] |
| `context?` | [`ErrorContextData`](../modules#errorcontextdata) |

#### Returns

[`ModelNotAvailableError`](ModelNotAvailableError)

#### Overrides

[RobotaError](RobotaError).[constructor](RobotaError#constructor)

#### Defined in

[packages/agents/src/utils/errors.ts:159](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/utils/errors.ts#L159)

## Properties

### stackTraceLimit

▪ `Static` **stackTraceLimit**: `number`

The `Error.stackTraceLimit` property specifies the number of stack frames
collected by a stack trace (whether generated by `new Error().stack` or
`Error.captureStackTrace(obj)`).

The default value is `10` but may be set to any valid JavaScript number. Changes
will affect any stack trace captured _after_ the value has been changed.

If set to a non-number value, or set to a negative number, stack traces will
not capture any frames.

#### Inherited from

[RobotaError](RobotaError).[stackTraceLimit](RobotaError#stacktracelimit)

#### Defined in

node_modules/.pnpm/@types+node@20.17.46/node_modules/@types/node/globals.d.ts:148

___

### cause

• `Optional` **cause**: `unknown`

#### Inherited from

[RobotaError](RobotaError).[cause](RobotaError#cause)

#### Defined in

node_modules/.pnpm/typescript@5.8.3/node_modules/typescript/lib/lib.es2022.error.d.ts:26

___

### name

• **name**: `string`

#### Inherited from

[RobotaError](RobotaError).[name](RobotaError#name)

#### Defined in

node_modules/.pnpm/typescript@5.8.3/node_modules/typescript/lib/lib.es5.d.ts:1076

___

### message

• **message**: `string`

#### Inherited from

[RobotaError](RobotaError).[message](RobotaError#message)

#### Defined in

node_modules/.pnpm/typescript@5.8.3/node_modules/typescript/lib/lib.es5.d.ts:1077

___

### stack

• `Optional` **stack**: `string`

#### Inherited from

[RobotaError](RobotaError).[stack](RobotaError#stack)

#### Defined in

node_modules/.pnpm/typescript@5.8.3/node_modules/typescript/lib/lib.es5.d.ts:1078

___

### context

• `Optional` `Readonly` **context**: [`ErrorContextData`](../modules#errorcontextdata)

#### Inherited from

[RobotaError](RobotaError).[context](RobotaError#context)

#### Defined in

[packages/agents/src/utils/errors.ts:27](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/utils/errors.ts#L27)

___

### code

• `Readonly` **code**: ``"MODEL_NOT_AVAILABLE"``

#### Overrides

[RobotaError](RobotaError).[code](RobotaError#code)

#### Defined in

[packages/agents/src/utils/errors.ts:155](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/utils/errors.ts#L155)

___

### category

• `Readonly` **category**: ``"user"``

#### Overrides

[RobotaError](RobotaError).[category](RobotaError#category)

#### Defined in

[packages/agents/src/utils/errors.ts:156](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/utils/errors.ts#L156)

___

### recoverable

• `Readonly` **recoverable**: ``false``

#### Overrides

[RobotaError](RobotaError).[recoverable](RobotaError#recoverable)

#### Defined in

[packages/agents/src/utils/errors.ts:157](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/utils/errors.ts#L157)

___

### availableModels

• `Optional` `Readonly` **availableModels**: `string`[]

#### Defined in

[packages/agents/src/utils/errors.ts:162](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/utils/errors.ts#L162)

## Methods

### captureStackTrace

▸ **captureStackTrace**(`targetObject`, `constructorOpt?`): `void`

Creates a `.stack` property on `targetObject`, which when accessed returns
a string representing the location in the code at which
`Error.captureStackTrace()` was called.

```js
const myObject = {};
Error.captureStackTrace(myObject);
myObject.stack;  // Similar to `new Error().stack`
```

The first line of the trace will be prefixed with
`${myObject.name}: ${myObject.message}`.

The optional `constructorOpt` argument accepts a function. If given, all frames
above `constructorOpt`, including `constructorOpt`, will be omitted from the
generated stack trace.

The `constructorOpt` argument is useful for hiding implementation
details of error generation from the user. For instance:

```js
function a() {
  b();
}

function b() {
  c();
}

function c() {
  // Create an error without stack trace to avoid calculating the stack trace twice.
  const { stackTraceLimit } = Error;
  Error.stackTraceLimit = 0;
  const error = new Error();
  Error.stackTraceLimit = stackTraceLimit;

  // Capture the stack trace above function b
  Error.captureStackTrace(error, b); // Neither function c, nor b is included in the stack trace
  throw error;
}

a();
```

#### Parameters

| Name | Type |
| :------ | :------ |
| `targetObject` | `object` |
| `constructorOpt?` | `Function` |

#### Returns

`void`

#### Inherited from

[RobotaError](RobotaError).[captureStackTrace](RobotaError#capturestacktrace)

#### Defined in

node_modules/.pnpm/@types+node@20.17.46/node_modules/@types/node/globals.d.ts:132

___

### prepareStackTrace

▸ **prepareStackTrace**(`err`, `stackTraces`): `any`

#### Parameters

| Name | Type |
| :------ | :------ |
| `err` | `Error` |
| `stackTraces` | `CallSite`[] |

#### Returns

`any`

**`See`**

https://v8.dev/docs/stack-trace-api#customizing-stack-traces

#### Inherited from

[RobotaError](RobotaError).[prepareStackTrace](RobotaError#preparestacktrace)

#### Defined in

node_modules/.pnpm/@types+node@20.17.46/node_modules/@types/node/globals.d.ts:136
