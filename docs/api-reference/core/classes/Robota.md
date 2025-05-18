[Core API](../../) / [Exports](../modules) / Robota

# Class: Robota

Robota의 메인 클래스
에이전트를 초기화하고 실행하는 인터페이스 제공

**`Example`**

```ts
const robota = new Robota({
  provider: new OpenAIProvider({
    model: 'gpt-4',
    client: openaiClient
  }),
  systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다.'
});

const response = await robota.run('안녕하세요!');
```

## Table of contents

### Constructors

- [constructor](Robota#constructor)

### Methods

- [addResponseToMemory](Robota#addresponsetomemory)
- [addSystemMessage](Robota#addsystemmessage)
- [callMcpTool](Robota#callmcptool)
- [chat](Robota#chat)
- [clearMemory](Robota#clearmemory)
- [closeMcpClient](Robota#closemcpclient)
- [configureFunctionCall](Robota#configurefunctioncall)
- [getMcpResource](Robota#getmcpresource)
- [listMcpTools](Robota#listmcptools)
- [registerFunction](Robota#registerfunction)
- [registerFunctions](Robota#registerfunctions)
- [run](Robota#run)
- [runStream](Robota#runstream)
- [runWithMcpTool](Robota#runwithmcptool)
- [setFunctionCallMode](Robota#setfunctioncallmode)
- [setSystemMessages](Robota#setsystemmessages)
- [setSystemPrompt](Robota#setsystemprompt)

## Constructors

### constructor

• **new Robota**(`options`): [`Robota`](Robota)

Robota 인스턴스 생성

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `options` | [`RobotaOptions`](../interfaces/RobotaOptions) | Robota 초기화 옵션 |

#### Returns

[`Robota`](Robota)

#### Defined in

[packages/core/src/robota.ts:61](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L61)

## Methods

### addResponseToMemory

▸ **addResponseToMemory**(`response`): `void`

응답 메시지 추가

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `response` | [`ModelResponse`](../interfaces/ModelResponse) | 모델 응답 |

#### Returns

`void`

#### Defined in

[packages/core/src/robota.ts:434](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L434)

___

### addSystemMessage

▸ **addSystemMessage**(`content`): `void`

기존 시스템 메시지에 새 시스템 메시지 추가

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `content` | `string` | 추가할 시스템 메시지 내용 |

#### Returns

`void`

#### Defined in

[packages/core/src/robota.ts:258](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L258)

___

### callMcpTool

▸ **callMcpTool**(`toolName`, `params`): `Promise`\<`any`\>

MCP 도구 호출

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `toolName` | `string` | 도구 이름 |
| `params` | `any` | 도구 매개변수 |

#### Returns

`Promise`\<`any`\>

도구 호출 결과

#### Defined in

[packages/core/src/robota.ts:156](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L156)

___

### chat

▸ **chat**(`message`, `options?`): `Promise`\<`string`\>

채팅 메시지 처리 및 응답 생성

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `string` | 사용자 메시지 |
| `options` | [`RunOptions`](../interfaces/RunOptions) | 실행 옵션 |

#### Returns

`Promise`\<`string`\>

모델 응답 내용

#### Defined in

[packages/core/src/robota.ts:393](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L393)

___

### clearMemory

▸ **clearMemory**(): `void`

메모리 초기화

#### Returns

`void`

#### Defined in

[packages/core/src/robota.ts:445](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L445)

___

### closeMcpClient

▸ **closeMcpClient**(): `Promise`\<`void`\>

MCP 클라이언트 회기 종료

#### Returns

`Promise`\<`void`\>

#### Defined in

[packages/core/src/robota.ts:939](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L939)

___

### configureFunctionCall

▸ **configureFunctionCall**(`config`): `void`

함수 호출 설정 구성

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `config` | `Object` | 함수 호출 구성 옵션 |
| `config.allowedFunctions?` | `string`[] | - |
| `config.maxCalls?` | `number` | - |
| `config.mode?` | [`FunctionCallMode`](../modules#functioncallmode) | - |
| `config.timeout?` | `number` | - |

#### Returns

`void`

#### Defined in

[packages/core/src/robota.ts:299](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L299)

___

### getMcpResource

▸ **getMcpResource**(`uri`): `Promise`\<`any`\>

MCP 리소스 가져오기

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `uri` | `string` | 리소스 URI |

#### Returns

`Promise`\<`any`\>

리소스 내용

#### Defined in

[packages/core/src/robota.ts:186](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L186)

___

### listMcpTools

▸ **listMcpTools**(): `Promise`\<`any`[]\>

MCP 도구 목록 가져오기

#### Returns

`Promise`\<`any`[]\>

MCP 도구 목록

#### Defined in

[packages/core/src/robota.ts:131](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L131)

___

### registerFunction

▸ **registerFunction**(`schema`, `fn`): `void`

단일 함수 등록

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `schema` | [`FunctionSchema`](../interfaces/FunctionSchema) | 함수 스키마 |
| `fn` | `Function` | 함수 구현 |

#### Returns

`void`

#### Defined in

[packages/core/src/robota.ts:352](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L352)

___

### registerFunctions

▸ **registerFunctions**(`functions`): `void`

여러 함수 등록

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `functions` | `Record`\<`string`, `Function`\> | 함수 이름과 구현을 담은 객체 |

#### Returns

`void`

#### Defined in

[packages/core/src/robota.ts:324](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L324)

___

### run

▸ **run**(`prompt`, `options?`): `Promise`\<`string`\>

텍스트 프롬프트 실행

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `prompt` | `string` | 사용자 프롬프트 |
| `options` | [`RunOptions`](../interfaces/RunOptions) | 실행 옵션 |

#### Returns

`Promise`\<`string`\>

모델 응답 내용

#### Defined in

[packages/core/src/robota.ts:375](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L375)

___

### runStream

▸ **runStream**(`prompt`, `options?`): `Promise`\<`AsyncIterable`\<[`StreamingResponseChunk`](../interfaces/StreamingResponseChunk), `any`, `any`\>\>

스트리밍 응답 생성

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `prompt` | `string` | 사용자 프롬프트 |
| `options` | [`RunOptions`](../interfaces/RunOptions) | 실행 옵션 |

#### Returns

`Promise`\<`AsyncIterable`\<[`StreamingResponseChunk`](../interfaces/StreamingResponseChunk), `any`, `any`\>\>

스트리밍 응답 청크 이터레이터

#### Defined in

[packages/core/src/robota.ts:424](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L424)

___

### runWithMcpTool

▸ **runWithMcpTool**(`toolName`, `params`, `followUp?`): `Promise`\<`string`\>

MCP 도구를 사용하여 작업 실행

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `toolName` | `string` | 도구 이름 |
| `params` | `any` | 도구 매개변수 |
| `followUp?` | `string` | 도구 호출 후 후속 프롬프트 |

#### Returns

`Promise`\<`string`\>

실행 결과

#### Defined in

[packages/core/src/robota.ts:208](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L208)

___

### setFunctionCallMode

▸ **setFunctionCallMode**(`mode`): `void`

함수 호출 모드 설정

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `mode` | [`FunctionCallMode`](../modules#functioncallmode) | 함수 호출 모드 ('auto', 'force', 'disabled') |

#### Returns

`void`

#### Defined in

[packages/core/src/robota.ts:290](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L290)

___

### setSystemMessages

▸ **setSystemMessages**(`messages`): `void`

여러 시스템 메시지 설정

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `messages` | [`Message`](../interfaces/Message)[] | 시스템 메시지 배열 |

#### Returns

`void`

#### Defined in

[packages/core/src/robota.ts:248](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L248)

___

### setSystemPrompt

▸ **setSystemPrompt**(`prompt`): `void`

단일 시스템 프롬프트 설정

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `prompt` | `string` | 시스템 프롬프트 내용 |

#### Returns

`void`

#### Defined in

[packages/core/src/robota.ts:238](https://github.com/woojubb/robota/blob/1202ed01072674e4ff6307d72c09a57873f8f949/packages/core/src/robota.ts#L238)
