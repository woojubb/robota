<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[agents](../../) / [Exports](../modules) / BasePluginOptions

# Interface: BasePluginOptions

Base plugin options that all plugin options should extend
This provides a common structure while allowing specific options

## Hierarchy

- **`BasePluginOptions`**

  ↳ [`ErrorHandlingPluginOptions`](ErrorHandlingPluginOptions)

  ↳ [`LimitsPluginOptions`](LimitsPluginOptions)

  ↳ [`EventEmitterPluginOptions`](EventEmitterPluginOptions)

  ↳ [`WebhookPluginOptions`](WebhookPluginOptions)

  ↳ [`PluginConfig`](PluginConfig)

  ↳ [`ConversationHistoryPluginOptions`](ConversationHistoryPluginOptions)

  ↳ [`LoggingPluginOptions`](LoggingPluginOptions)

  ↳ [`UsagePluginOptions`](UsagePluginOptions)

  ↳ [`PerformancePluginOptions`](PerformancePluginOptions)

  ↳ [`ExecutionAnalyticsOptions`](ExecutionAnalyticsOptions)

## Table of contents

### Properties

- [enabled](BasePluginOptions#enabled)
- [category](BasePluginOptions#category)
- [priority](BasePluginOptions#priority)
- [moduleEvents](BasePluginOptions#moduleevents)
- [subscribeToAllModuleEvents](BasePluginOptions#subscribetoallmoduleevents)

## Properties

### enabled

• `Optional` **enabled**: `boolean`

Whether the plugin is enabled

#### Defined in

[packages/agents/src/abstracts/base-plugin.ts:125](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/abstracts/base-plugin.ts#L125)

___

### category

• `Optional` **category**: [`PluginCategory`](../enums/PluginCategory)

Plugin category for classification

#### Defined in

[packages/agents/src/abstracts/base-plugin.ts:127](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/abstracts/base-plugin.ts#L127)

___

### priority

• `Optional` **priority**: `number`

Plugin priority for execution order

#### Defined in

[packages/agents/src/abstracts/base-plugin.ts:129](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/abstracts/base-plugin.ts#L129)

___

### moduleEvents

• `Optional` **moduleEvents**: [`EventType`](../modules#eventtype)[]

Events to subscribe to from modules

#### Defined in

[packages/agents/src/abstracts/base-plugin.ts:131](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/abstracts/base-plugin.ts#L131)

___

### subscribeToAllModuleEvents

• `Optional` **subscribeToAllModuleEvents**: `boolean`

Whether to subscribe to all module events

#### Defined in

[packages/agents/src/abstracts/base-plugin.ts:133](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/abstracts/base-plugin.ts#L133)
