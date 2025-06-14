<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[core](../../) / [Exports](../modules) / SystemMessage

# Interface: SystemMessage

System message interface - for system instructions and prompts

## Hierarchy

- [`BaseMessage`](BaseMessage)

  ↳ **`SystemMessage`**

## Table of contents

### Properties

- [timestamp](SystemMessage#timestamp)
- [metadata](SystemMessage#metadata)
- [role](SystemMessage#role)
- [content](SystemMessage#content)
- [name](SystemMessage#name)

## Properties

### timestamp

• **timestamp**: `Date`

Message creation timestamp

#### Inherited from

[BaseMessage](BaseMessage).[timestamp](BaseMessage#timestamp)

#### Defined in

[conversation-history.ts:17](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L17)

___

### metadata

• `Optional` **metadata**: `Record`\<`string`, `any`\>

Additional metadata

#### Inherited from

[BaseMessage](BaseMessage).[metadata](BaseMessage#metadata)

#### Defined in

[conversation-history.ts:20](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L20)

___

### role

• **role**: ``"system"``

Message role - always 'system'

#### Defined in

[conversation-history.ts:72](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L72)

___

### content

• **content**: `string`

System instruction content

#### Defined in

[conversation-history.ts:75](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L75)

___

### name

• `Optional` **name**: `string`

Optional system message identifier

#### Defined in

[conversation-history.ts:78](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/core/src/conversation-history.ts#L78)
