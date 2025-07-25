<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[agents](../../) / [Exports](../modules) / AggregatedExecutionStats

# Interface: AggregatedExecutionStats

Aggregated execution statistics

## Table of contents

### Properties

- [totalExecutions](AggregatedExecutionStats#totalexecutions)
- [successfulExecutions](AggregatedExecutionStats#successfulexecutions)
- [failedExecutions](AggregatedExecutionStats#failedexecutions)
- [successRate](AggregatedExecutionStats#successrate)
- [averageDuration](AggregatedExecutionStats#averageduration)
- [totalDuration](AggregatedExecutionStats#totalduration)
- [operationStats](AggregatedExecutionStats#operationstats)
- [errorStats](AggregatedExecutionStats#errorstats)
- [timeRange](AggregatedExecutionStats#timerange)

## Properties

### totalExecutions

• **totalExecutions**: `number`

#### Defined in

[packages/agents/src/plugins/execution/types.ts:44](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/execution/types.ts#L44)

___

### successfulExecutions

• **successfulExecutions**: `number`

#### Defined in

[packages/agents/src/plugins/execution/types.ts:45](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/execution/types.ts#L45)

___

### failedExecutions

• **failedExecutions**: `number`

#### Defined in

[packages/agents/src/plugins/execution/types.ts:46](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/execution/types.ts#L46)

___

### successRate

• **successRate**: `number`

#### Defined in

[packages/agents/src/plugins/execution/types.ts:47](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/execution/types.ts#L47)

___

### averageDuration

• **averageDuration**: `number`

#### Defined in

[packages/agents/src/plugins/execution/types.ts:48](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/execution/types.ts#L48)

___

### totalDuration

• **totalDuration**: `number`

#### Defined in

[packages/agents/src/plugins/execution/types.ts:49](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/execution/types.ts#L49)

___

### operationStats

• **operationStats**: `Record`\<`string`, \{ `count`: `number` ; `successCount`: `number` ; `failureCount`: `number` ; `averageDuration`: `number` ; `totalDuration`: `number`  }\>

#### Defined in

[packages/agents/src/plugins/execution/types.ts:50](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/execution/types.ts#L50)

___

### errorStats

• **errorStats**: `Record`\<`string`, `number`\>

#### Defined in

[packages/agents/src/plugins/execution/types.ts:57](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/execution/types.ts#L57)

___

### timeRange

• **timeRange**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `start` | `Date` |
| `end` | `Date` |

#### Defined in

[packages/agents/src/plugins/execution/types.ts:58](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/agents/src/plugins/execution/types.ts#L58)
