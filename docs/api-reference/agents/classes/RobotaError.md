<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[agents](../../) / [Exports](../modules) / RobotaError

# Class: RobotaError

Base error class for all Robota errors

## Hierarchy

- `Error`

  ↳ **`RobotaError`**

  ↳↳ [`ConfigurationError`](ConfigurationError)

  ↳↳ [`ValidationError`](ValidationError)

  ↳↳ [`ProviderError`](ProviderError)

  ↳↳ [`AuthenticationError`](AuthenticationError)

  ↳↳ [`RateLimitError`](RateLimitError)

  ↳↳ [`NetworkError`](NetworkError)

  ↳↳ [`ToolExecutionError`](ToolExecutionError)

  ↳↳ [`ModelNotAvailableError`](ModelNotAvailableError)

  ↳↳ [`CircuitBreakerOpenError`](CircuitBreakerOpenError)

  ↳↳ [`PluginError`](PluginError)

  ↳↳ [`StorageError`](StorageError)

## Table of contents

### Constructors

- [constructor](RobotaError#constructor)

### Properties

- [stackTraceLimit](RobotaError#stacktracelimit)
- [cause](RobotaError#cause)
- [name](RobotaError#name)
- [message](RobotaError#message)
- [stack](RobotaError#stack)
- [code](RobotaError#code)
- [category](RobotaError#category)
- [recoverable](RobotaError#recoverable)
- [context](RobotaError#context)

### Methods

- [captureStackTrace](RobotaError#capturestacktrace)
- [prepareStackTrace](RobotaError#preparestacktrace)

## Constructors

### constructor

• **new RobotaError**(`message`, `context?`): [`RobotaError`](RobotaError)

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `string` |
| `context?` | [`ErrorContextData`](../modules#errorcontextdata) |

#### Returns

[`RobotaError`](RobotaError)

#### Overrides

Error.constructor

#### Defined in

[packages/agents/src/utils/errors.ts:25](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/utils/errors.ts#L25)

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

Error.stackTraceLimit

#### Defined in

node_modules/.pnpm/@types+node@20.17.46/node_modules/@types/node/globals.d.ts:148

___

### cause

• `Optional` **cause**: `unknown`

#### Inherited from

Error.cause

#### Defined in

node_modules/.pnpm/typescript@5.8.3/node_modules/typescript/lib/lib.es2022.error.d.ts:26

___

### name

• **name**: `string`

#### Inherited from

Error.name

#### Defined in

node_modules/.pnpm/typescript@5.8.3/node_modules/typescript/lib/lib.es5.d.ts:1076

___

### message

• **message**: `string`

#### Inherited from

Error.message

#### Defined in

node_modules/.pnpm/typescript@5.8.3/node_modules/typescript/lib/lib.es5.d.ts:1077

___

### stack

• `Optional` **stack**: `string`

#### Inherited from

Error.stack

#### Defined in

node_modules/.pnpm/typescript@5.8.3/node_modules/typescript/lib/lib.es5.d.ts:1078

___

### code

• `Readonly` `Abstract` **code**: `string`

#### Defined in

[packages/agents/src/utils/errors.ts:21](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/utils/errors.ts#L21)

___

### category

• `Readonly` `Abstract` **category**: ``"user"`` \| ``"system"`` \| ``"provider"``

#### Defined in

[packages/agents/src/utils/errors.ts:22](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/utils/errors.ts#L22)

___

### recoverable

• `Readonly` `Abstract` **recoverable**: `boolean`

#### Defined in

[packages/agents/src/utils/errors.ts:23](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/utils/errors.ts#L23)

___

### context

• `Optional` `Readonly` **context**: [`ErrorContextData`](../modules#errorcontextdata)

#### Defined in

[packages/agents/src/utils/errors.ts:27](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/utils/errors.ts#L27)

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

Error.captureStackTrace

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

Error.prepareStackTrace

#### Defined in

node_modules/.pnpm/@types+node@20.17.46/node_modules/@types/node/globals.d.ts:136
