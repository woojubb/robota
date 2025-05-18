[Tools API](../../) / [Exports](../modules) / ToolResult

# Interface: ToolResult\<T\>

도구 실행 결과 타입

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |

## Table of contents

### Properties

- [data](ToolResult#data)
- [error](ToolResult#error)
- [metadata](ToolResult#metadata)
- [success](ToolResult#success)

## Properties

### data

• `Optional` **data**: `T`

도구 실행 결과 데이터

#### Defined in

[index.ts:19](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L19)

___

### error

• `Optional` **error**: `string`

도구 실행 중 발생한 오류

#### Defined in

[index.ts:24](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L24)

___

### metadata

• `Optional` **metadata**: `Record`\<`string`, `any`\>

추가 메타데이터

#### Defined in

[index.ts:29](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L29)

___

### success

• **success**: `boolean`

도구 실행 성공 여부

#### Defined in

[index.ts:14](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L14)
