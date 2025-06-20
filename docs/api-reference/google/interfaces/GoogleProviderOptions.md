<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[google](../../) / [Exports](../modules) / GoogleProviderOptions

# Interface: GoogleProviderOptions

Google AI Provider options

## Table of contents

### Properties

- [client](GoogleProviderOptions#client)
- [model](GoogleProviderOptions#model)
- [temperature](GoogleProviderOptions#temperature)
- [maxTokens](GoogleProviderOptions#maxtokens)
- [responseMimeType](GoogleProviderOptions#responsemimetype)
- [responseSchema](GoogleProviderOptions#responseschema)

## Properties

### client

• **client**: `GoogleGenerativeAI`

Google AI client instance

#### Defined in

[google/src/types.ts:8](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/google/src/types.ts#L8)

___

### model

• `Optional` **model**: `string`

Default model to use

#### Defined in

[google/src/types.ts:11](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/google/src/types.ts#L11)

___

### temperature

• `Optional` **temperature**: `number`

Temperature setting (0.0 ~ 1.0)

#### Defined in

[google/src/types.ts:14](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/google/src/types.ts#L14)

___

### maxTokens

• `Optional` **maxTokens**: `number`

Maximum number of tokens

#### Defined in

[google/src/types.ts:17](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/google/src/types.ts#L17)

___

### responseMimeType

• `Optional` **responseMimeType**: ``"text/plain"`` \| ``"application/json"``

Response MIME type
- 'text/plain': Plain text response (default)
- 'application/json': JSON response format

#### Defined in

[google/src/types.ts:24](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/google/src/types.ts#L24)

___

### responseSchema

• `Optional` **responseSchema**: `Record`\<`string`, `unknown`\>

Response schema for JSON output (only used when responseMimeType is 'application/json')

#### Defined in

[google/src/types.ts:29](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/google/src/types.ts#L29)
