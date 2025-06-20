<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[tools](../../) / [Exports](../modules) / OpenAPIToolProvider

# Class: OpenAPIToolProvider

OpenAPI-based tool provider class

## Hierarchy

- [`BaseToolProvider`](BaseToolProvider)

  ↳ **`OpenAPIToolProvider`**

## Table of contents

### Constructors

- [constructor](OpenAPIToolProvider#constructor)

### Properties

- [functions](OpenAPIToolProvider#functions)

### Methods

- [callTool](OpenAPIToolProvider#calltool)
- [getAvailableTools](OpenAPIToolProvider#getavailabletools)
- [hasTool](OpenAPIToolProvider#hastool)

## Constructors

### constructor

• **new OpenAPIToolProvider**(`options`): [`OpenAPIToolProvider`](OpenAPIToolProvider)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | [`OpenAPIToolProviderOptions`](../interfaces/OpenAPIToolProviderOptions) |

#### Returns

[`OpenAPIToolProvider`](OpenAPIToolProvider)

#### Overrides

[BaseToolProvider](BaseToolProvider).[constructor](BaseToolProvider#constructor)

#### Defined in

[packages/tools/src/openapi-tool-provider.ts:24](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/openapi-tool-provider.ts#L24)

## Properties

### functions

• `Optional` **functions**: [`FunctionSchema`](../interfaces/FunctionSchema)[]

Abstract property to be implemented by concrete providers

#### Overrides

[BaseToolProvider](BaseToolProvider).[functions](BaseToolProvider#functions)

#### Defined in

[packages/tools/src/openapi-tool-provider.ts:22](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/openapi-tool-provider.ts#L22)

## Methods

### callTool

▸ **callTool**(`toolName`, `parameters`): `Promise`\<`any`\>

Tool call implementation

#### Parameters

| Name | Type |
| :------ | :------ |
| `toolName` | `string` |
| `parameters` | `Record`\<`string`, `any`\> |

#### Returns

`Promise`\<`any`\>

#### Overrides

[BaseToolProvider](BaseToolProvider).[callTool](BaseToolProvider#calltool)

#### Defined in

[packages/tools/src/openapi-tool-provider.ts:118](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/openapi-tool-provider.ts#L118)

___

### getAvailableTools

▸ **getAvailableTools**(): `string`[]

Return available tool list (override)

#### Returns

`string`[]

#### Overrides

[BaseToolProvider](BaseToolProvider).[getAvailableTools](BaseToolProvider#getavailabletools)

#### Defined in

[packages/tools/src/openapi-tool-provider.ts:146](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/openapi-tool-provider.ts#L146)

___

### hasTool

▸ **hasTool**(`toolName`): `boolean`

Check if specific tool exists (override)

#### Parameters

| Name | Type |
| :------ | :------ |
| `toolName` | `string` |

#### Returns

`boolean`

#### Overrides

[BaseToolProvider](BaseToolProvider).[hasTool](BaseToolProvider#hastool)

#### Defined in

[packages/tools/src/openapi-tool-provider.ts:157](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/tools/src/openapi-tool-provider.ts#L157)
