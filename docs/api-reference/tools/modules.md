[Tools API](../) / Exports

# Tools API

## Table of contents

### Classes

- [ToolRegistry](classes/ToolRegistry)

### Interfaces

- [CreateToolOptions](interfaces/CreateToolOptions)
- [Tool](interfaces/Tool)
- [ToolParameter](interfaces/ToolParameter)
- [ToolResult](interfaces/ToolResult)

### Functions

- [createTool](modules#createtool)

## Functions

### createTool

▸ **createTool**\<`TInput`, `TOutput`\>(`options`): [`Tool`](interfaces/Tool)\<`TInput`, `TOutput`\>

도구 생성 함수

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TInput` | `any` |
| `TOutput` | `any` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `options` | [`CreateToolOptions`](interfaces/CreateToolOptions)\<`TInput`, `TOutput`\> | 도구 생성 옵션 |

#### Returns

[`Tool`](interfaces/Tool)\<`TInput`, `TOutput`\>

생성된 도구

**`Example`**

```ts
const weatherTool = createTool({
  name: 'getWeather',
  description: '특정 위치의 날씨 정보를 가져옵니다',
  parameters: [
    { name: 'location', type: 'string', description: '위치 (도시명)', required: true }
  ],
  execute: async ({ location }) => {
    // 날씨 API 호출 로직
    return { temperature: 25, humidity: 60, conditions: '맑음' };
  }
});
```

#### Defined in

[index.ts:117](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/tools/src/index.ts#L117)
