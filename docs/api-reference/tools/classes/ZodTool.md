[Tools API](../../) / [Exports](../modules) / ZodTool

# Class: ZodTool\<TParams, TResult\>

Zod schema-based tool class

 ZodTool

**`Description`**

Tool that uses Zod schema for parameter validation.

**`Example`**

```typescript
import { z } from 'zod';
import { ZodTool } from '@robota-sdk/core';

const weatherTool = new ZodTool({
  name: 'getWeather',
  description: 'Get weather information for a specific location.',
  category: 'data',
  version: '1.0.0',
  parameters: z.object({
    location: z.string().describe('Location to get weather for (city name)'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature unit')
  }),
  execute: async (params) => {
    // Weather API call logic
    const data = { temperature: 25, condition: 'sunny' };
    return {
      status: 'success',
      data
    };
  }
});
```

## Type parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `TParams` | `any` | Tool parameter type |
| `TResult` | `any` | Tool result type |

## Hierarchy

- [`BaseTool`](BaseTool)\<`TParams`, `TResult`\>

  ↳ **`ZodTool`**

## Table of contents

### Constructors

- [constructor](ZodTool#constructor)

### Properties

- [category](ZodTool#category)
- [description](ZodTool#description)
- [name](ZodTool#name)
- [version](ZodTool#version)

### Accessors

- [schema](ZodTool#schema)

### Methods

- [execute](ZodTool#execute)
- [toFunctionDefinition](ZodTool#tofunctiondefinition)
- [toFunctionSchema](ZodTool#tofunctionschema)
- [toString](ZodTool#tostring)
- [create](ZodTool#create)

## Constructors

### constructor

• **new ZodTool**\<`TParams`, `TResult`\>(`options`): [`ZodTool`](ZodTool)\<`TParams`, `TResult`\>

Constructor

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TParams` | `any` |
| `TResult` | `any` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `options` | [`ZodToolOptions`](../interfaces/ZodToolOptions)\<`TParams`, `TResult`\> | Zod tool options |

#### Returns

[`ZodTool`](ZodTool)\<`TParams`, `TResult`\>

#### Overrides

[BaseTool](BaseTool).[constructor](BaseTool#constructor)

#### Defined in

[packages/tools/src/tool/zod-tool.ts:61](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/zod-tool.ts#L61)

## Properties

### category

• `Optional` `Readonly` **category**: `string`

Tool category

#### Inherited from

[BaseTool](BaseTool).[category](BaseTool#category)

#### Defined in

[packages/tools/src/tool/base-tool.ts:39](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/base-tool.ts#L39)

___

### description

• `Readonly` **description**: `string`

Tool description

#### Inherited from

[BaseTool](BaseTool).[description](BaseTool#description)

#### Defined in

[packages/tools/src/tool/base-tool.ts:34](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/base-tool.ts#L34)

___

### name

• `Readonly` **name**: `string`

Tool name

#### Inherited from

[BaseTool](BaseTool).[name](BaseTool#name)

#### Defined in

[packages/tools/src/tool/base-tool.ts:29](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/base-tool.ts#L29)

___

### version

• `Optional` `Readonly` **version**: `string`

Tool version

#### Inherited from

[BaseTool](BaseTool).[version](BaseTool#version)

#### Defined in

[packages/tools/src/tool/base-tool.ts:44](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/base-tool.ts#L44)

## Accessors

### schema

• `get` **schema**(): `ZodObject`\<`any`, `UnknownKeysParam`, `ZodTypeAny`, {}, {}\>

Tool schema (returns Zod schema)

#### Returns

`ZodObject`\<`any`, `UnknownKeysParam`, `ZodTypeAny`, {}, {}\>

Zod schema

#### Overrides

BaseTool.schema

#### Defined in

[packages/tools/src/tool/zod-tool.ts:71](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/zod-tool.ts#L71)

## Methods

### execute

▸ **execute**(`params`): `Promise`\<`ToolResult`\<`TResult`\>\>

Execute tool

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `params` | `TParams` | Tool parameters |

#### Returns

`Promise`\<`ToolResult`\<`TResult`\>\>

Tool execution result

#### Inherited from

[BaseTool](BaseTool).[execute](BaseTool#execute)

#### Defined in

[packages/tools/src/tool/base-tool.ts:108](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/base-tool.ts#L108)

___

### toFunctionDefinition

▸ **toFunctionDefinition**(): [`FunctionDefinition`](../interfaces/FunctionDefinition)

Convert to function definition

#### Returns

[`FunctionDefinition`](../interfaces/FunctionDefinition)

Function definition

#### Inherited from

[BaseTool](BaseTool).[toFunctionDefinition](BaseTool#tofunctiondefinition)

#### Defined in

[packages/tools/src/tool/base-tool.ts:158](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/base-tool.ts#L158)

___

### toFunctionSchema

▸ **toFunctionSchema**(): [`FunctionSchema`](../interfaces/FunctionSchema)

Convert to function schema

#### Returns

[`FunctionSchema`](../interfaces/FunctionSchema)

Function schema

#### Inherited from

[BaseTool](BaseTool).[toFunctionSchema](BaseTool#tofunctionschema)

#### Defined in

[packages/tools/src/tool/base-tool.ts:145](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/base-tool.ts#L145)

___

### toString

▸ **toString**(): `string`

Generate string representation

#### Returns

`string`

String representation of the tool

#### Inherited from

[BaseTool](BaseTool).[toString](BaseTool#tostring)

#### Defined in

[packages/tools/src/tool/base-tool.ts:171](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/base-tool.ts#L171)

___

### create

▸ **create**\<`TParams`, `TResult`\>(`options`): [`ZodTool`](ZodTool)\<`TParams`, `TResult`\>

Zod tool creation helper method

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TParams` | `any` |
| `TResult` | `any` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `options` | [`ZodToolOptions`](../interfaces/ZodToolOptions)\<`TParams`, `TResult`\> | Zod tool options |

#### Returns

[`ZodTool`](ZodTool)\<`TParams`, `TResult`\>

ZodTool instance

#### Defined in

[packages/tools/src/tool/zod-tool.ts:185](https://github.com/woojubb/robota/blob/67406abb83c9116fb1693a24e5876025b7fb3063/packages/tools/src/tool/zod-tool.ts#L185)
