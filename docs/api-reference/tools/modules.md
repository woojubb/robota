[Tools API](../) / Exports

# Tools API

## Table of contents

### Classes

- [BaseTool](classes/BaseTool)
- [FunctionRegistry](classes/FunctionRegistry)
- [McpTool](classes/McpTool)
- [OpenApiTool](classes/OpenApiTool)
- [ToolRegistry](classes/ToolRegistry)
- [ZodTool](classes/ZodTool)

### Interfaces

- [CreateToolOptions](interfaces/CreateToolOptions)
- [Function](interfaces/Function)
- [FunctionCall](interfaces/FunctionCall)
- [FunctionCallResult](interfaces/FunctionCallResult)
- [FunctionDefinition](interfaces/FunctionDefinition)
- [FunctionOptions](interfaces/FunctionOptions)
- [FunctionSchema](interfaces/FunctionSchema)
- [Tool](interfaces/Tool)
- [ToolParameter](interfaces/ToolParameter)
- [ToolProvider](interfaces/ToolProvider)
- [ToolResult](interfaces/ToolResult)

### Type Aliases

- [FunctionHandler](modules#functionhandler)
- [FunctionResult](modules#functionresult)

### Functions

- [createFunction](modules#createfunction)
- [createFunctionSchema](modules#createfunctionschema)
- [createMcpToolProvider](modules#createmcptoolprovider)
- [createOpenAPIToolProvider](modules#createopenapitoolprovider)
- [createTool](modules#createtool)
- [createZodFunctionToolProvider](modules#createzodfunctiontoolprovider)
- [functionFromCallback](modules#functionfromcallback)
- [zodFunctionToSchema](modules#zodfunctiontoschema)
- [zodToJsonSchema](modules#zodtojsonschema)

## Type Aliases

### FunctionHandler

Ƭ **FunctionHandler**: (`args`: `Record`\<`string`, `any`\>, `context?`: `any`) => `Promise`\<`any`\>

Function call handler type

#### Type declaration

▸ (`args`, `context?`): `Promise`\<`any`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `args` | `Record`\<`string`, `any`\> |
| `context?` | `any` |

##### Returns

`Promise`\<`any`\>

#### Defined in

[packages/tools/src/function.ts:326](https://github.com/woojubb/robota/blob/main/packages/tools/src/function.ts#L326)

___

### FunctionResult

Ƭ **FunctionResult**\<`TResult`\>: `Object`

Function result type

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TResult` | `any` |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `result` | `TResult` |

#### Defined in

[packages/tools/src/function.ts:14](https://github.com/woojubb/robota/blob/main/packages/tools/src/function.ts#L14)

## Functions

### createFunction

▸ **createFunction**\<`TParams`, `TResult`\>(`options`): [`Function`](interfaces/Function)\<`TParams`, `TResult`\>

Create a function that AI can invoke with automatic parameter validation

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TParams` | `any` |
| `TResult` | `any` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `options` | [`FunctionOptions`](interfaces/FunctionOptions)\<`TParams`, `TResult`\> | Function options |

#### Returns

[`Function`](interfaces/Function)\<`TParams`, `TResult`\>

Created function object

**`Example`**

```typescript
import { z } from 'zod';
import { createFunction } from '@robota-sdk/tools';

const getWeather = createFunction({
  name: 'getWeather',
  description: 'Get weather information for a specific location.',
  parameters: z.object({
    location: z.string().describe('Location to check weather (city name)'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature unit')
  }),
  execute: async (params) => {
    // Weather API call logic
    return { temperature: 25, condition: 'sunny' };
  }
});
```

#### Defined in

[packages/tools/src/function.ts:210](https://github.com/woojubb/robota/blob/main/packages/tools/src/function.ts#L210)

___

### createTool

▸ **createTool**\<`TInput`, `TOutput`\>(`options`): [`Tool`](interfaces/Tool)\<`TInput`, `TOutput`\>

Tool creation function

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TInput` | `any` |
| `TOutput` | `any` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `options` | [`CreateToolOptions`](interfaces/CreateToolOptions)\<`TInput`, `TOutput`\> | Tool creation options |

#### Returns

[`Tool`](interfaces/Tool)\<`TInput`, `TOutput`\>

Created tool

**`Example`**

```typescript
const weatherTool = createTool({
  name: 'getWeather',
  description: 'Get weather information for a specific location',
  parameters: [
    { name: 'location', type: 'string', description: 'Location (city name)', required: true }
  ],
  execute: async ({ location }) => {
    // Weather API call logic
    return { temperature: 25, humidity: 60, conditions: 'sunny' };
  }
});
```

#### Defined in

[packages/tools/src/index.ts:117](https://github.com/woojubb/robota/blob/main/packages/tools/src/index.ts#L117)
