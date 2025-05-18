[Core API](../../) / [Exports](../modules) / FunctionSchema

# Interface: FunctionSchema

함수 스키마 인터페이스

## Table of contents

### Properties

- [description](FunctionSchema#description)
- [name](FunctionSchema#name)
- [parameters](FunctionSchema#parameters)

## Properties

### description

• `Optional` **description**: `string`

#### Defined in

[packages/core/src/types.ts:57](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L57)

___

### name

• **name**: `string`

#### Defined in

[packages/core/src/types.ts:56](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L56)

___

### parameters

• **parameters**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `properties` | `Record`\<`string`, \{ `default?`: `any` ; `description?`: `string` ; `enum?`: `any`[] ; `type`: `string`  }\> |
| `required?` | `string`[] |
| `type` | ``"object"`` |

#### Defined in

[packages/core/src/types.ts:58](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/types.ts#L58)
