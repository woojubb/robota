<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[core](../../) / [Exports](../modules) / AgentCreationConfig

# Interface: AgentCreationConfig

Configuration for creating a task-specific agent using templates

## Table of contents

### Properties

- [templateName](AgentCreationConfig#templatename)
- [taskDescription](AgentCreationConfig#taskdescription)
- [requiredTools](AgentCreationConfig#requiredtools)
- [agentConfig](AgentCreationConfig#agentconfig)

## Properties

### templateName

• `Optional` **templateName**: `string`

Template name to use (optional)

#### Defined in

[packages/core/src/types.ts:149](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/core/src/types.ts#L149)

___

### taskDescription

• `Optional` **taskDescription**: `string`

Task description for dynamic agent creation

#### Defined in

[packages/core/src/types.ts:151](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/core/src/types.ts#L151)

___

### requiredTools

• `Optional` **requiredTools**: `string`[]

Required tools for the task

#### Defined in

[packages/core/src/types.ts:153](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/core/src/types.ts#L153)

___

### agentConfig

• `Optional` **agentConfig**: `Partial`\<[`AgentConfig`](AgentConfig)\>

Agent configuration overrides

#### Defined in

[packages/core/src/types.ts:155](https://github.com/woojubb/robota/blob/cb1bdf4e9982efe5a4622cbb23e0f1ae10892662/packages/core/src/types.ts#L155)
