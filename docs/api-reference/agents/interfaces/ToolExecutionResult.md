<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[agents](../../) / [Exports](../modules) / ToolExecutionResult

# Interface: ToolExecutionResult

Enhanced tool execution result with additional metadata

## Table of contents

### Properties

- [success](ToolExecutionResult#success)
- [toolName](ToolExecutionResult#toolname)
- [result](ToolExecutionResult#result)
- [error](ToolExecutionResult#error)
- [duration](ToolExecutionResult#duration)
- [executionId](ToolExecutionResult#executionid)
- [metadata](ToolExecutionResult#metadata)

## Properties

### success

• **success**: `boolean`

Whether execution was successful

#### Defined in

[packages/agents/src/interfaces/tool.ts:74](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/interfaces/tool.ts#L74)

___

### toolName

• `Optional` **toolName**: `string`

Tool name that was executed

#### Defined in

[packages/agents/src/interfaces/tool.ts:76](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/interfaces/tool.ts#L76)

___

### result

• `Optional` **result**: [`ToolExecutionData`](../modules#toolexecutiondata)

Execution result or data

#### Defined in

[packages/agents/src/interfaces/tool.ts:78](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/interfaces/tool.ts#L78)

___

### error

• `Optional` **error**: `string`

Error message if execution failed

#### Defined in

[packages/agents/src/interfaces/tool.ts:80](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/interfaces/tool.ts#L80)

___

### duration

• `Optional` **duration**: `number`

Execution duration in milliseconds

#### Defined in

[packages/agents/src/interfaces/tool.ts:82](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/interfaces/tool.ts#L82)

___

### executionId

• `Optional` **executionId**: `string`

Unique execution ID

#### Defined in

[packages/agents/src/interfaces/tool.ts:84](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/interfaces/tool.ts#L84)

___

### metadata

• `Optional` **metadata**: [`ToolMetadata`](../modules#toolmetadata)

Additional metadata

#### Defined in

[packages/agents/src/interfaces/tool.ts:86](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/interfaces/tool.ts#L86)
