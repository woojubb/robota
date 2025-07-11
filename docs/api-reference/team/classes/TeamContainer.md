<!-- 
 ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 This file is automatically generated by scripts/docs-generator.js
 To make changes, edit the source TypeScript files or update the generator script
-->

[team](../../) / [Exports](../modules) / TeamContainer

# Class: TeamContainer

TeamContainer - Multi-Agent Team Collaboration System

**`Description`**

The TeamContainer class implements an intelligent multi-agent collaboration system 
where a primary team coordinator can dynamically delegate specialized tasks to 
temporary expert agents. This enables solving complex, multi-faceted problems 
through coordinated teamwork.

**`Features`**

- **Intelligent Task Delegation**: Automatically breaks down complex requests into specialized components
- **Dynamic Agent Creation**: Creates temporary expert agents tailored for specific tasks
- **Collaborative Workflows**: Coordinates multiple agents to solve multi-faceted problems
- **Result Integration**: Synthesizes outputs from multiple agents into cohesive responses
- **Resource Management**: Automatic cleanup and resource management for temporary agents
- **Performance Monitoring**: Comprehensive statistics and performance tracking via ExecutionAnalyticsPlugin

**`Example`**

```typescript
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';

const team = createTeam({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
  }),
  maxTokenLimit: 50000,
  logger: console
});

const response = await team.execute(`
  Create a comprehensive business plan including:
  1) Market analysis
  2) Financial projections  
  3) Marketing strategy
`);
```

**`Example`**

```typescript
const team = new TeamContainer({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    maxTokenLimit: 50000
  },
  maxMembers: 10,
  debug: true
});

// The team intelligently delegates work
const result = await team.execute(
  'Design a complete mobile app including UI/UX design, backend architecture, and deployment strategy'
);

// View team performance statistics from ExecutionAnalyticsPlugin
const analyticsStats = team.getAnalytics();
console.log(`Success rate: ${(analyticsStats.successRate * 100).toFixed(1)}%`);
console.log(`Average execution time: ${analyticsStats.averageDuration.toFixed(0)}ms`);
```

**`See`**

 - [createTeam](../modules#createteam) - Convenience function for creating teams
 - AssignTaskParams - Parameters for task assignment

## Table of contents

### Constructors

- [constructor](TeamContainer#constructor)

### Methods

- [execute](TeamContainer#execute)
- [getAnalytics](TeamContainer#getanalytics)
- [getExecutionStats](TeamContainer#getexecutionstats)
- [getStatus](TeamContainer#getstatus)
- [clearAnalytics](TeamContainer#clearanalytics)
- [getAnalyticsData](TeamContainer#getanalyticsdata)
- [getPluginStatuses](TeamContainer#getpluginstatuses)
- [getDelegationHistory](TeamContainer#getdelegationhistory)
- [getTeamExecutionAnalysis](TeamContainer#getteamexecutionanalysis)
- [clearDelegationHistory](TeamContainer#cleardelegationhistory)
- [getStats](TeamContainer#getstats)
- [getTeamStats](TeamContainer#getteamstats)
- [resetTeamStats](TeamContainer#resetteamstats)
- [getTemplates](TeamContainer#gettemplates)
- [getTemplate](TeamContainer#gettemplate)

## Constructors

### constructor

• **new TeamContainer**(`options`): [`TeamContainer`](TeamContainer)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | [`TeamContainerOptions`](../interfaces/TeamContainerOptions) |

#### Returns

[`TeamContainer`](TeamContainer)

#### Defined in

[team/src/team-container.ts:160](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L160)

## Methods

### execute

▸ **execute**(`userPrompt`): `Promise`\<`string`\>

Execute a task using the team approach

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `userPrompt` | `string` | The task to execute |

#### Returns

`Promise`\<`string`\>

Promise\<string\> - The result of the task execution

#### Defined in

[team/src/team-container.ts:223](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L223)

___

### getAnalytics

▸ **getAnalytics**(): `undefined` \| `PluginStats`

Get team analytics from ExecutionAnalyticsPlugin

#### Returns

`undefined` \| `PluginStats`

#### Defined in

[team/src/team-container.ts:489](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L489)

___

### getExecutionStats

▸ **getExecutionStats**(`operation?`): `ExecutionStats`[]

Get execution statistics by operation type

#### Parameters

| Name | Type |
| :------ | :------ |
| `operation?` | `string` |

#### Returns

`ExecutionStats`[]

#### Defined in

[team/src/team-container.ts:500](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L500)

___

### getStatus

▸ **getStatus**(): `undefined` \| \{ `name`: `string` ; `version`: `string` ; `enabled`: `boolean` ; `initialized`: `boolean` ; `category`: `PluginCategory` ; `priority`: `number` ; `subscribedEventsCount`: `number` ; `hasEventEmitter`: `boolean`  }

Get detailed plugin status and memory usage

#### Returns

`undefined` \| \{ `name`: `string` ; `version`: `string` ; `enabled`: `boolean` ; `initialized`: `boolean` ; `category`: `PluginCategory` ; `priority`: `number` ; `subscribedEventsCount`: `number` ; `hasEventEmitter`: `boolean`  }

#### Defined in

[team/src/team-container.ts:511](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L511)

___

### clearAnalytics

▸ **clearAnalytics**(): `void`

Clear analytics data

#### Returns

`void`

#### Defined in

[team/src/team-container.ts:522](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L522)

___

### getAnalyticsData

▸ **getAnalyticsData**(): `undefined` \| `PluginData`

Get raw analytics data

#### Returns

`undefined` \| `PluginData`

#### Defined in

[team/src/team-container.ts:532](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L532)

___

### getPluginStatuses

▸ **getPluginStatuses**(): (\{ `name`: `string` ; `version`: `string` ; `enabled`: `boolean` ; `initialized`: `boolean` ; `category`: `PluginCategory` ; `priority`: `number` ; `subscribedEventsCount`: `number` ; `hasEventEmitter`: `boolean`  } \| \{ `name`: `string` = plugin.name; `version`: `string` = plugin.version; `enabled`: `boolean` ; `initialized`: `boolean` = true })[]

Get all plugin statuses

#### Returns

(\{ `name`: `string` ; `version`: `string` ; `enabled`: `boolean` ; `initialized`: `boolean` ; `category`: `PluginCategory` ; `priority`: `number` ; `subscribedEventsCount`: `number` ; `hasEventEmitter`: `boolean`  } \| \{ `name`: `string` = plugin.name; `version`: `string` = plugin.version; `enabled`: `boolean` ; `initialized`: `boolean` = true })[]

#### Defined in

[team/src/team-container.ts:543](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L543)

___

### getDelegationHistory

▸ **getDelegationHistory**(): `TaskDelegationRecord`[]

Get delegation history

Returns raw delegation records for detailed analysis

#### Returns

`TaskDelegationRecord`[]

#### Defined in

[team/src/team-container.ts:563](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L563)

___

### getTeamExecutionAnalysis

▸ **getTeamExecutionAnalysis**(): `TeamExecutionAnalysis`

Get team execution analysis

Provides comprehensive analysis of how the team handled tasks,
including delegation patterns and performance metrics

#### Returns

`TeamExecutionAnalysis`

#### Defined in

[team/src/team-container.ts:573](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L573)

___

### clearDelegationHistory

▸ **clearDelegationHistory**(): `void`

Clear delegation history

#### Returns

`void`

#### Defined in

[team/src/team-container.ts:630](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L630)

___

### getStats

▸ **getStats**(): `Object`

Get statistics for team performance (alias for getTeamStats)

#### Returns

`Object`

Object containing team performance statistics

| Name | Type |
| :------ | :------ |
| `tasksCompleted` | `number` |
| `totalAgentsCreated` | `number` |
| `totalExecutionTime` | `number` |

**`Description`**

Returns statistics about team performance including task completion,
agent creation, and execution time. This method is used by examples
to show team performance metrics.

#### Defined in

[team/src/team-container.ts:648](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L648)

___

### getTeamStats

▸ **getTeamStats**(): `Object`

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `activeAgentsCount` | `number` |
| `totalAgentsCreated` | `number` |
| `maxMembers` | `string` \| `number` |
| `delegationHistoryLength` | `number` |
| `successfulTasks` | `number` |
| `failedTasks` | `number` |
| `tasksCompleted` | `number` |
| `totalExecutionTime` | `number` |

#### Defined in

[team/src/team-container.ts:656](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L656)

___

### resetTeamStats

▸ **resetTeamStats**(): `void`

Reset team statistics

#### Returns

`void`

#### Defined in

[team/src/team-container.ts:672](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L672)

___

### getTemplates

▸ **getTemplates**(): `AgentTemplate`[]

Get available templates

#### Returns

`AgentTemplate`[]

#### Defined in

[team/src/team-container.ts:683](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L683)

___

### getTemplate

▸ **getTemplate**(`templateId`): `undefined` \| `AgentTemplate`

Get template by ID

#### Parameters

| Name | Type |
| :------ | :------ |
| `templateId` | `string` |

#### Returns

`undefined` \| `AgentTemplate`

#### Defined in

[team/src/team-container.ts:690](https://github.com/woojubb/robota/blob/87419dbb26faf50d7f1d60ae717fbe215743d1f6/packages/team/src/team-container.ts#L690)
