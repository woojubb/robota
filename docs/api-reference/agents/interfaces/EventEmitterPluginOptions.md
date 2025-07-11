<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[agents](../../) / [Exports](../modules) / EventEmitterPluginOptions

# Interface: EventEmitterPluginOptions

Event emitter configuration

## Hierarchy

- [`BasePluginOptions`](BasePluginOptions)

  ↳ **`EventEmitterPluginOptions`**

## Table of contents

### Properties

- [enabled](EventEmitterPluginOptions#enabled)
- [category](EventEmitterPluginOptions#category)
- [priority](EventEmitterPluginOptions#priority)
- [moduleEvents](EventEmitterPluginOptions#moduleevents)
- [subscribeToAllModuleEvents](EventEmitterPluginOptions#subscribetoallmoduleevents)
- [events](EventEmitterPluginOptions#events)
- [maxListeners](EventEmitterPluginOptions#maxlisteners)
- [async](EventEmitterPluginOptions#async)
- [catchErrors](EventEmitterPluginOptions#catcherrors)
- [filters](EventEmitterPluginOptions#filters)
- [buffer](EventEmitterPluginOptions#buffer)

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

### events

• `Optional` **events**: [`EventType`](../modules#eventtype)[]

Events to listen for

#### Defined in

[packages/agents/src/plugins/event-emitter-plugin.ts:130](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/event-emitter-plugin.ts#L130)

___

### maxListeners

• `Optional` **maxListeners**: `number`

Maximum number of listeners per event type

#### Defined in

[packages/agents/src/plugins/event-emitter-plugin.ts:132](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/event-emitter-plugin.ts#L132)

___

### async

• `Optional` **async**: `boolean`

Whether to emit events asynchronously

#### Defined in

[packages/agents/src/plugins/event-emitter-plugin.ts:134](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/event-emitter-plugin.ts#L134)

___

### catchErrors

• `Optional` **catchErrors**: `boolean`

Whether to catch and log listener errors

#### Defined in

[packages/agents/src/plugins/event-emitter-plugin.ts:136](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/event-emitter-plugin.ts#L136)

___

### filters

• `Optional` **filters**: `Record`\<[`EventType`](../modules#eventtype), (`event`: [`EventData`](EventData)) => `boolean`\>

Custom event filters

#### Defined in

[packages/agents/src/plugins/event-emitter-plugin.ts:138](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/event-emitter-plugin.ts#L138)

___

### buffer

• `Optional` **buffer**: `Object`

Event buffering options

#### Type declaration

| Name | Type |
| :------ | :------ |
| `enabled` | `boolean` |
| `maxSize` | `number` |
| `flushInterval` | `number` |

#### Defined in

[packages/agents/src/plugins/event-emitter-plugin.ts:140](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/event-emitter-plugin.ts#L140)
