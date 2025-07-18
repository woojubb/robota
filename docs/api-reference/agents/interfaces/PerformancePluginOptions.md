<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[agents](../../) / [Exports](../modules) / PerformancePluginOptions

# Interface: PerformancePluginOptions

Configuration options for performance plugin

## Hierarchy

- [`BasePluginOptions`](BasePluginOptions)

  ↳ **`PerformancePluginOptions`**

## Table of contents

### Properties

- [enabled](PerformancePluginOptions#enabled)
- [category](PerformancePluginOptions#category)
- [priority](PerformancePluginOptions#priority)
- [moduleEvents](PerformancePluginOptions#moduleevents)
- [subscribeToAllModuleEvents](PerformancePluginOptions#subscribetoallmoduleevents)
- [strategy](PerformancePluginOptions#strategy)
- [filePath](PerformancePluginOptions#filepath)
- [remoteEndpoint](PerformancePluginOptions#remoteendpoint)
- [prometheusEndpoint](PerformancePluginOptions#prometheusendpoint)
- [remoteHeaders](PerformancePluginOptions#remoteheaders)
- [maxEntries](PerformancePluginOptions#maxentries)
- [monitorMemory](PerformancePluginOptions#monitormemory)
- [monitorCPU](PerformancePluginOptions#monitorcpu)
- [monitorNetwork](PerformancePluginOptions#monitornetwork)
- [batchSize](PerformancePluginOptions#batchsize)
- [flushInterval](PerformancePluginOptions#flushinterval)
- [aggregateStats](PerformancePluginOptions#aggregatestats)
- [aggregationInterval](PerformancePluginOptions#aggregationinterval)
- [performanceThreshold](PerformancePluginOptions#performancethreshold)

## Properties

### enabled

• `Optional` **enabled**: `boolean`

Whether the plugin is enabled

#### Inherited from

[BasePluginOptions](BasePluginOptions).[enabled](BasePluginOptions#enabled)

#### Defined in

[packages/agents/src/abstracts/base-plugin.ts:125](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/abstracts/base-plugin.ts#L125)

___

### category

• `Optional` **category**: [`PluginCategory`](../enums/PluginCategory)

Plugin category for classification

#### Inherited from

[BasePluginOptions](BasePluginOptions).[category](BasePluginOptions#category)

#### Defined in

[packages/agents/src/abstracts/base-plugin.ts:127](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/abstracts/base-plugin.ts#L127)

___

### priority

• `Optional` **priority**: `number`

Plugin priority for execution order

#### Inherited from

[BasePluginOptions](BasePluginOptions).[priority](BasePluginOptions#priority)

#### Defined in

[packages/agents/src/abstracts/base-plugin.ts:129](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/abstracts/base-plugin.ts#L129)

___

### moduleEvents

• `Optional` **moduleEvents**: [`EventType`](../modules#eventtype)[]

Events to subscribe to from modules

#### Inherited from

[BasePluginOptions](BasePluginOptions).[moduleEvents](BasePluginOptions#moduleevents)

#### Defined in

[packages/agents/src/abstracts/base-plugin.ts:131](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/abstracts/base-plugin.ts#L131)

___

### subscribeToAllModuleEvents

• `Optional` **subscribeToAllModuleEvents**: `boolean`

Whether to subscribe to all module events

#### Inherited from

[BasePluginOptions](BasePluginOptions).[subscribeToAllModuleEvents](BasePluginOptions#subscribetoallmoduleevents)

#### Defined in

[packages/agents/src/abstracts/base-plugin.ts:133](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/abstracts/base-plugin.ts#L133)

___

### strategy

• **strategy**: [`PerformanceMonitoringStrategy`](../modules#performancemonitoringstrategy)

Performance monitoring strategy to use

#### Defined in

[packages/agents/src/plugins/performance/types.ts:86](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L86)

___

### filePath

• `Optional` **filePath**: `string`

File path for file strategy

#### Defined in

[packages/agents/src/plugins/performance/types.ts:88](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L88)

___

### remoteEndpoint

• `Optional` **remoteEndpoint**: `string`

Remote endpoint for remote strategy

#### Defined in

[packages/agents/src/plugins/performance/types.ts:90](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L90)

___

### prometheusEndpoint

• `Optional` **prometheusEndpoint**: `string`

Prometheus endpoint for prometheus strategy

#### Defined in

[packages/agents/src/plugins/performance/types.ts:92](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L92)

___

### remoteHeaders

• `Optional` **remoteHeaders**: `Record`\<`string`, `string`\>

Headers for remote monitoring

#### Defined in

[packages/agents/src/plugins/performance/types.ts:94](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L94)

___

### maxEntries

• `Optional` **maxEntries**: `number`

Maximum number of performance entries to keep in memory

#### Defined in

[packages/agents/src/plugins/performance/types.ts:96](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L96)

___

### monitorMemory

• `Optional` **monitorMemory**: `boolean`

Whether to monitor memory usage

#### Defined in

[packages/agents/src/plugins/performance/types.ts:98](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L98)

___

### monitorCPU

• `Optional` **monitorCPU**: `boolean`

Whether to monitor CPU usage

#### Defined in

[packages/agents/src/plugins/performance/types.ts:100](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L100)

___

### monitorNetwork

• `Optional` **monitorNetwork**: `boolean`

Whether to monitor network stats

#### Defined in

[packages/agents/src/plugins/performance/types.ts:102](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L102)

___

### batchSize

• `Optional` **batchSize**: `number`

Batch size for remote reporting

#### Defined in

[packages/agents/src/plugins/performance/types.ts:104](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L104)

___

### flushInterval

• `Optional` **flushInterval**: `number`

Flush interval for batched reporting in milliseconds

#### Defined in

[packages/agents/src/plugins/performance/types.ts:106](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L106)

___

### aggregateStats

• `Optional` **aggregateStats**: `boolean`

Whether to aggregate statistics

#### Defined in

[packages/agents/src/plugins/performance/types.ts:108](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L108)

___

### aggregationInterval

• `Optional` **aggregationInterval**: `number`

Aggregation interval in milliseconds

#### Defined in

[packages/agents/src/plugins/performance/types.ts:110](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L110)

___

### performanceThreshold

• `Optional` **performanceThreshold**: `number`

Performance threshold in milliseconds to log warnings

#### Defined in

[packages/agents/src/plugins/performance/types.ts:112](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/performance/types.ts#L112)
