<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[tools](../../) / [Exports](../modules) / ResourceStats

# Interface: ResourceStats

Resource statistics

## Table of contents

### Properties

- [totalResources](ResourceStats#totalresources)
- [byType](ResourceStats#bytype)
- [oldestResourceAge](ResourceStats#oldestresourceage)
- [averageResourceAge](ResourceStats#averageresourceage)
- [estimatedMemoryUsage](ResourceStats#estimatedmemoryusage)
- [systemMemory](ResourceStats#systemmemory)

## Properties

### totalResources

• **totalResources**: `number`

Total resources count

#### Defined in

[packages/tools/src/performance/resource-manager.ts:56](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/tools/src/performance/resource-manager.ts#L56)

___

### byType

• **byType**: `Record`\<[`ResourceType`](../modules#resourcetype), `number`\>

Resource count by type

#### Defined in

[packages/tools/src/performance/resource-manager.ts:58](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/tools/src/performance/resource-manager.ts#L58)

___

### oldestResourceAge

• **oldestResourceAge**: `number`

Oldest resource age (milliseconds)

#### Defined in

[packages/tools/src/performance/resource-manager.ts:60](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/tools/src/performance/resource-manager.ts#L60)

___

### averageResourceAge

• **averageResourceAge**: `number`

Average resource age (milliseconds)

#### Defined in

[packages/tools/src/performance/resource-manager.ts:62](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/tools/src/performance/resource-manager.ts#L62)

___

### estimatedMemoryUsage

• **estimatedMemoryUsage**: `number`

Total estimated memory usage

#### Defined in

[packages/tools/src/performance/resource-manager.ts:64](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/tools/src/performance/resource-manager.ts#L64)

___

### systemMemory

• **systemMemory**: [`MemoryInfo`](MemoryInfo)

System memory information

#### Defined in

[packages/tools/src/performance/resource-manager.ts:66](https://github.com/woojubb/robota/blob/16fe5ea8d551b6fd37698b011433e41053ce5a38/packages/tools/src/performance/resource-manager.ts#L66)
