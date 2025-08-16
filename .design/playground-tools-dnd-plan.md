# 플레이그라운드 Tools 관리 및 드래그앤드롭(DnD) 설계 계획 (순차 진행 문서)

본 문서는 기초 → 심화 순서로 단계별로 진행되는 설계/개발 계획입니다. 각 단계는 선행 단계가 성공적으로 검증된 후 다음 단계로 진행됩니다. 또한 본 설계는 단일 선형 플로우가 아닌, 하나의 워크플로우 안에 여러 종류의 노드 워크플로우(예: 단일 에이전트 플로우, 팀 플로우, 도구 호출로 파생된 서브 플로우 등)가 혼재하는 상황을 전제로 합니다.

## 0. 목표와 범위
- 목표: 우측 사이드바 `Tools` 섹션에서 툴 카드를 관리(목록/추가/삭제 기본)하고, 카드를 캔버스의 특정 `agent` 노드로 드롭했을 때 해당 Agent에 Tool이 추가되는 워크플로우를 완성
- 1차 범위(UI 우선):
  - Tools 목록 UI/상태 관리(임시 스토어)
  - DnD 상호작용(툴 카드 → Agent 노드)
  - Agent 노드의 드래그 반응(시각적 강조) 및 드롭 후 UI 오버레이 상태 갱신
- 2차 범위(후속 계획):
  - 실제 Agent Config에 Tool 반영(정확 타겟의 구성에 merge)
  - 영속화/복원(필요 시)

## 0.2 우선순위 로드맵 (상위 → 하위)
- [P0] 기초/환경 준비: 스키마·카탈로그·폴더 구조(가장 먼저)
  - [x] ToolConfig 스키마 표준화: kind → id 전환(문서/설계 반영 완료)
  - [ ] PlaygroundToolMeta에 type(builtin|mcp|openapi|zod) 확정 및 사용 지점 표준화
  - [ ] apps/web/src/tools/assign-task/ 스캐폴딩(index.ts, README)
  - [ ] getPlaygroundToolCatalog() 도입 및 사이드바 목록을 카탈로그 기반으로 전환
  - [ ] 사이드바 DnD 데이터 포맷(id/name/description) 카탈로그 기준으로 통일
- [P1] 코어(agents/workflow): 에이전트 툴 설정 업데이트 기능 확립
- [P2] 웹 브릿지: 에이전트 인스턴스 접근/호출 경로 마련
- [P3] UI: DnD → 브릿지 호출 → 반영 표시(오버레이)
- [P4] 문서/검증: 혼재 플로우/경계 조건 점검

### 0.1 혼재 워크플로우 전제 및 요구사항
- 하나의 렌더링 트리 안에 다음과 같은 다중/혼재 플로우가 동시에 존재할 수 있음:
  - 단일 에이전트 플로우(Agent ↔ User)
  - 팀 플로우(Team → Agent 분기/집계)
  - 툴 호출로 생성된 파생 플로우(Agent Thinking → Tool Call → Agent/Response)
- DnD 설계는 어떤 플로우 위의 `agent` 노드에 드롭되더라도 동일하게 동작해야 하며, 플로우 간 간섭을 일으키지 않아야 함
- 특정 에이전트 타겟팅은 노드의 명시적 필드(`id`/`data.sourceId`)만 사용하며, 문자열 파싱/추론 금지(Path-Only 철학과 동일하게 명시적 데이터만 사용)

## 1. 준수 원칙(필수)
- Path-Only 그래프 규칙: 본 기능은 UI 레벨 기능이며, Workflow 그래프 생성/연결 로직에는 영향을 주지 않음(경로 기반 연결 정책을 훼손하지 않음)
- No Fallback Policy: UI 상호작용 실패 시 침묵 처리/자동 대체 금지. 명시적 오류 메시지 또는 무시(로그)
- Event Ownership: 본 기능은 앱 UI 상태 변경이므로 SDK의 `execution.*`, `agent.*`, `tool.*` 이벤트를 임의로 발생시키지 않음
- Hook 규칙 준수: 모든 훅 호출은 컴포넌트 최상위에서만, 조건부 미호출 금지
- 소스 오브 트루스: SDK에서 온 `workflow`는 불변으로 취급. UI 오버레이 상태(`addedToolsByAgent`)는 별도로 관리하고 렌더링 시 병합하여 표기
- 빌드 규칙: `apps/web` 수정 후 앱 빌드는 필요 시 진행

### 1.1 혼재 시나리오 고려 사항
- 동일 시점에 여러 `agent` 노드가 시각에 보일 수 있으며, 각 노드는 독립적인 DnD 타겟으로 동작
- 툴 추가 UI는 노드별로 독립적으로 반영되어야 하며, 다른 플로우의 에이전트에 영향을 주지 않음
- 팀 플로우(분기/집계), 파생된 서브 플로우(툴 → 에이전트)의 존재와 무관하게 동일 정책 유지

## 2. 아키텍처 개요
- 사이드바 `Tools` 섹션
  - 도메인 모델(임시):
    ```ts
    interface ToolItem {
      id: string;          // 고유 식별자 (ex. 'assignTask')
      name: string;        // 표시명
      description?: string;
      parameters?: Record<string, unknown>; // (선택) 파라미터 스키마 요약
    }
    ```
  - 관리 상태: `toolItems: ToolItem[]`
  - DnD: 카드 `dragstart`에서 `dataTransfer.setData('application/robota-tool', JSON.stringify(tool))`

- 캔버스/Agent 노드
  - `AgentNode`가 DnD 타겟이 되어 `dragenter`/`dragover`/`dragleave`/`drop` 이벤트를 처리
  - 드래그 진입 시 시각적 강조, 드롭 시 파싱된 ToolItem을 상위 콜백으로 전달
  - 상위에서 `addedToolsByAgent: Record<agentId, string[]>` 업데이트(중복 방지)

- UI 오버레이 병합 표시
  - 렌더링 시 `data.tools`(SDK에서 제공) ∪ `addedToolsByAgent[agentId]`를 합집합으로 계산하여 뱃지 렌더링
  - 실제 Agent Config 반영은 2차 범위에서 별도 구현

### 2.1 설정 업데이트/확인 기능(읽기/쓰기 분리)
- 에이전트가 설정의 단일 소유자이며, 업데이트와 읽기 모두 에이전트 메서드로만 수행
- 이벤트 상수: 기존 `AGENT_EVENTS`가 선언된 모듈에 `CONFIG_UPDATED` 추가(소유자: agents 패키지)
- 업데이트 시: `AGENT_EVENTS.CONFIG_UPDATED` 발생. 핸들러는 해당 agent 노드의 데이터만 업데이트(구조 변경 없음)
- 읽기 시: 이벤트 불필요. UI는 읽기 전용 메서드로 확인
- 권장 메서드 초안:
  - `updateTools(next: ToolDefinition[]): Promise<{ version: number }>`
  - `updateConfiguration(patch: AgentConfigPatch): Promise<{ version: number }>`
  - `getConfiguration(): Promise<{ version: number; tools: ToolSummary[]; updatedAt: number; metadata?: Record<string, unknown> }>`
  - `validateConfiguration(patch: AgentConfigPatch): Promise<ValidationResult>` (선택)

#### CONFIG_UPDATED 페이로드(초안)
```ts
// 소유: @robota-sdk/agents
// 위치: 기존 AGENT_EVENTS 선언 파일
export const AGENT_EVENTS = {
  // ...existing
  CONFIG_UPDATED: 'agent.config_updated'
} as const;

// emit payload (초안)
{
  sourceType: 'agent',
  sourceId: string,          // rootId/conversationId
  timestamp: Date,
  parameters: {
    tools: ToolSummary[]     // name/parameters 요약
  },
  version: number,           // 설정 버전
  rootExecutionId?: string,  // 가능 시 포함(문맥)
  executionLevel: 0,
  metadata?: Record<string, unknown>
}
```

#### 핸들러 동작(초안)
- AgentEventHandler: `CONFIG_UPDATED` → 해당 agent 노드의 `data.tools`(및 `data.configVersion`)만 업데이트
- 노드/엣지 생성/삭제 없음(업데이트 전용)

### 2.2 설정 Object 표준(단일 소스 오브 트루스)
- 목적: 하나의 설정 Object로 Agent와 Tool을 동일하게 생성/복원 가능해야 함
- 직렬화 가능(JSON)만 허용. 함수/순환참조 금지. 저장 위치는 파일/메모리/LocalStorage 모두 허용

#### 표준 스키마(초안)
```ts
interface ToolConfig {
  id: string;                      // 예: "assignTask", "webSearch" — implementation identifier
  name?: string;                     // 표시명(선택)
  parameters?: Record<string, unknown>; // 도구별 파라미터(직렬화 가능)
  version?: number;                  // 마이그레이션 대비(선택)
  metadata?: Record<string, unknown>;// 표시/추적용(선택)
}

interface DefaultModelConfig {
  provider: string;                  // 예: 'openai' | 'anthropic' | 'google'
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemMessage?: string;
}

interface AgentConfigObject {
  id: string;                        // 안정적 ID(rootId와 동일 사용 가능)
  name: string;
  defaultModel: DefaultModelConfig;
  tools: ToolConfig[];               // 도구 목록의 유일 소스
  metadata?: Record<string, unknown>;
  version?: number;                  // 설정 버전(증분)
  hash?: string;                     // 정렬키 기반 해시(선택)
}
```

#### 생성 팩토리(순수 함수)
```ts
// agents 패키지(도메인 중립)
AgentFactory.createFromConfig(config: AgentConfigObject): Robota;

// tools 레지스트리(팩토리 집합)
ToolFactory.createFromConfigArray(toolConfigs: ToolConfig[]): Tool[];

// kind → 구현체 매핑(정적)
type ToolRegistry = Record<string, (cfg: ToolConfig) => Tool>;
```
- 정적 매핑 필수(동적 import 금지). UI/이벤트 로직과 분리

### 2.3 통합 툴 팩토리(단일 진입점)
- 목적: 기존 개별 툴 팩토리들은 유지하되, 하나의 통합 팩토리에서 `id` 기반으로 위임하여 Tool 인스턴스를 생성
- 도메인 중립, 정적 매핑, 엄격한 검증/에러 정책

#### API 초안
```ts
namespace UnifiedToolFactory {
  // 단일 항목 생성
  export function create(config: ToolConfig): Tool;

  // 다중 항목 생성(정렬/중복 제거 포함)
  export function createMany(configs: ToolConfig[]): Tool[];

  // (선택) 앱 초기화 시 확장 등록 - 런타임 동적 import 금지, 정적 함수만 연결
  export function register(id: string, builder: (cfg: ToolConfig) => Tool): void;
}
```

#### 동작 규칙
- 매핑 규칙: `id` → 기존 개별 팩토리(예: `assignTask` → `AssignTaskFactory.fromConfig`, `webSearch` → `WebSearchFactory.fromConfig`)
- 검증: 각 개별 팩토리에서 스키마 검증 수행, 실패 시 예외 throw(침묵/대체 경로 금지)
- 중복 제거: `name || id`를 key로 하여 case-insensitive 중복 제거(우선 첫 번째 유지)
- 순서: 입력 순서 안정성 유지(중복 제거 이후 상대적 순서 보존)
- 매핑 누락: 등록되지 않은 `id`는 명시적 에러(지원하지 않는 도구)
- 동적 확장: `register`는 앱 초기화 시점에서만 호출(핫 런타임 등록 금지)

#### 예시 구현 스케치
```ts
const registry: Record<string, (cfg: ToolConfig) => Tool> = {
  assignTask: AssignTaskFactory.fromConfig,
  webSearch: WebSearchFactory.fromConfig,
  // ... statically wired
};

export function create(config: ToolConfig): Tool {
  const builder = registry[config.id];
  if (!builder) throw new Error(`[UnifiedToolFactory] Unknown id: ${config.id}`);
  return builder(config);
}

export function createMany(configs: ToolConfig[]): Tool[] {
  const seen = new Set<string>();
  const result: Tool[] = [];
  for (const cfg of configs) {
    const key = (cfg.name || cfg.id).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(create(cfg));
  }
  return result;
}
```

#### AgentFactory 통합 사용
- `AgentFactory.createFromConfig(config)` 내부에서 `UnifiedToolFactory.createMany(config.tools)` 호출 → 결과를 `Robota` 생성자에 주입
- 설정 변경 시에도 동일 경로 재사용(업데이트 후 재생성 또는 런타임 업데이트 경로)

#### 저장·복원 규칙
- 동일 JSON을 그대로 저장/로드. 키 정렬 + MD5 등으로 `hash` 생성 가능(선택)
- 복원은 `AgentFactory.createFromConfig(load())`로 단순화

#### DnD 이후 업데이트 흐름(요약)
1) UI에서 `AgentConfigObject.tools` 배열에 ToolConfig append(이름 중복 방지)
2) `agent.updateConfiguration(patch)` 호출 → 내부 ToolManager 갱신 → `agent.config_updated` 발생
3) 워크플로 핸들러는 해당 agent 노드 데이터만 업데이트(구조 불변)

#### 규칙 검증 포인트
- 도메인 중립: 설정→생성 경로가 공용 팩토리로 고정, UI는 호출만 수행
- 이벤트 소유권: 업데이트 이벤트는 Agent만 발생
- Path-Only 영향 없음: 그래프 구조 변경 금지, 노드 데이터 업데이트만
- 직렬화 안정성: 순수 JSON 기반

## 3. 단계별 계획(체크리스트) — 순차 진행(세분화)

### 1단계 [P1]: 코어 설정 업데이트(agents/workflow)
- [x] 1.1 AGENT_EVENTS.CONFIG_UPDATED 상수 추가(소유: agents)
- [x] 1.2 Robota에 `updateTools(next)`, `updateConfiguration(patch)`, `getConfiguration()` 추가
- [x] 1.3 유효성 오류 시 예외 throw, 성공 시 `{ version }` 반환
- [x] 1.4 AgentEventHandler: `CONFIG_UPDATED` 처리(해당 agent 노드의 `data.tools`/`data.configVersion`만 update)
- 검증: 이벤트 하드코딩 금지, 소유권/Path-Only 준수, 노드/엣지 생성 금지 확인

세부 작업
- [x] A.1 `packages/agents/src/agents/constants.ts`에 `CONFIG_UPDATED` 상수 추가 및 `index.ts` 재수출
- [x] A.2 `Robota` 클래스에 내부 config 상태(version, updatedAt) 보관 필드 추가
- [x] A.3 `updateTools(next: ToolDefinition[])` 구현: 입력 검증 → 내부 ToolManager 갱신 → version++ → `CONFIG_UPDATED` emit
- [x] A.4 `updateConfiguration(patch: AgentConfigPatch)` 구현: partial merge → 동일 프로세스
- [x] A.5 `getConfiguration()` 구현: `{ version, tools: ToolSummary[], updatedAt, metadata }` 반환
- [x] A.6 `packages/workflow/src/handlers/agent-event-handler.ts`에서 `CONFIG_UPDATED` 케이스 추가: 해당 agent 노드 `data.tools`/`data.configVersion` 업데이트만 수행
- [x] A.7 타입/주석/문서화 보강(언어 규칙 준수)

실현가능성: 90% (완료)

규칙 준수 메모
- [x] 시간 순서 보장을 위해 `AgentEventHandler`의 thinking 노드 생성 시, 기존 노드들의 `timestamp`를 스캔해 `baseTimestamp = maxObservedTs + 1`로 보정. 대기/지연/재시도 없이 내부 타임스탬프를 결정하며, 명시적 필드만 사용(Path-Only/No-Fallback 준수). 그래프 구조나 연결 추론은 수행하지 않음.
- 근거: 기존 이벤트/핸들러 패턴에 부합하며, 구조 변경 없이 업데이트만 수행

### 2단계 [P2]: 브릿지/레지스트리(웹)
- [x] 2.1 executor 레지스트리: `conversationId(rootId) → agentInstance` 맵 도입
- [x] 2.2 메서드: `updateAgentTools(agentId, tools)`, `getAgentConfiguration(agentId)`
- [x] 2.3 `extractAgentId(node)`로 식별 표준화
- 검증: 브릿지 경로를 통해 코어 메서드 호출/응답 정상

세부 작업
- [x] B.1 `apps/web/src/lib/playground/robota-executor.ts`에 레지스트리 필드 및 CRUD 추가
- [x] B.2 Agent/Team 생성 시점에 레지스트리 등록/해제 로직 연결
- [x] B.3 `updateAgentTools` → 인스턴스 조회 → `agent.updateTools()` 호출 → 성공/실패 결과 반환
- [x] B.4 `getAgentConfiguration` → 인스턴스 조회 → `agent.getConfiguration()` 반환
- [ ] B.5 에러를 UI 표준 에러로 변환(사용자 메시지용)

실현가능성: 95%
- 근거: 웹 측 보일러플레이트성 변경이며 코어와 인터페이스만 맞추면 구현 용이

### 3단계 [P3]: Tools 목록 관리(UI)
- [ ] 1.1 `ToolItem` 타입 선언 및 유효성 체크(helper)
- [ ] 1.2 `toolItems` 상태 초기값 및 setter 준비
- [ ] 1.3 사이드바에 카드 리스트 렌더(스크롤/접근성 고려)
- [ ] 1.4 `+ Add Tool` 모달(간이 폼: name, description) 열기/닫기
- [ ] 1.5 ID 생성 규칙(소문자 kebab + 6자리 토큰) 및 중복 방지 로직
- [ ] 1.6 추가 후 정렬(알파벳/최근 순 택1) 및 포커스 이동
- [ ] 1.7 삭제/이름변경(선택, 후순위)
- 검증: 툴 추가/표시/스크롤/중복 방지/정렬 동작 수동 확인

세부 작업
- [ ] C.1 `ToolItem` 입력 폼 유효성(이름 1~64자, `[a-zA-Z0-9_-]`)
- [ ] C.2 ID 생성 규칙(소문자 kebab + 6자리 랜덤 토큰)
- [ ] C.3 목록 정렬/검색(선택)

실현가능성: 95%
- 근거: 순수 UI/상태 관리로 의존성이 낮음

### 4단계 [P3]: DnD 데이터 전달(툴 → 에이전트 노드)
- [x] 2.1 카드 `dragstart`: `dataTransfer.setData('application/robota-tool', json)` 구현
- [x] 2.2 캔버스 래퍼 `onDragOver`에서 `preventDefault()`(드롭 허용)
- [x] 2.3 AgentNode에 `dragenter`/`dragover`/`dragleave`/`drop` 바인딩
- [x] 2.4 드래그 진입 시 하이라이트 on, 이탈 시 off(타임아웃/중복 이벤트 대비)
- [x] 2.5 `drop`에서 JSON 파싱과 에러 처리(try/catch, 불량 데이터 무시)
- [x] 2.6 상위 콜백 `__onToolDrop(agentId, tool)` 호출 규약 확정
- [x] 2.7 드롭 완료 후 하이라이트 off 및 기본 이벤트 취소
- 검증: 콘솔 로그로 Agent/Tool 페이로드 확인, 하이라이트 토글 정확성 점검

세부 작업
- [x] D.1 AgentNode에 드래그 이벤트 바인딩 및 하이라이트 클래스 구현
- [x] D.2 드롭 데이터 파싱/검증 → 상위 콜백 `__onToolDrop` 호출
- [ ] D.3 중복 드롭 디바운스(옵션), 빠른 연속 드롭 시 UI 유지

실현가능성: 92%
- 근거: RF 노드 커스텀 컴포넌트 확장이며 기존 드래그 수신 로직과 호환

### 5단계 [P3]: UI 오버레이 상태 반영(addedToolsByAgent)
- [ ] 3.1 타입 정의 `AddedToolsByAgent = Record<AgentId, string[]>`
- [ ] 3.2 상위 페이지 상태 `addedToolsByAgent` 구현 및 초기화
- [ ] 3.3 `onToolDrop(agentId, tool)`에서 집합 추가(중복 제거: Set/배열 검사)
- [ ] 3.4 `WorkflowVisualization`에 `onToolDrop`/`addedToolsByAgent` prop 전달
- [ ] 3.5 `AgentNode` 렌더 시 `data.tools ∪ addedToolsByAgent[agentId]` 합집합 뱃지 표시
- [ ] 3.6 툴 제거 UI(선택): 뱃지 X 버튼으로 해제 기능
- 검증: 중복 방지/즉시 반영/UI 제거 동작 수동 확인

세부 작업
- [ ] E.1 병합 규칙 구현: `sdkTools ∪ overlayTools` 이름 기준(case-insensitive) 중복 제거
- [ ] E.2 오버레이 뱃지 스타일/제거 버튼(선택)
- [ ] E.3 성공/실패 토스트 표준화

실현가능성: 95%
- 근거: 표시/상태 병합 로직으로 위험도 낮음

### 4단계: 혼재 플로우 호환성 검증(기초)
- [ ] 4.1 예제 27(싱글)에서 여러 Agent가 동시 보이는 경우 처리 검증
- [ ] 4.2 예제 26(팀)에서 포크/조인 상황의 에이전트 타겟팅 검증
- [ ] 4.3 툴 파생 서브 플로우(툴→Agent) 존재 시 상호 간섭/이중 반영 방지 검증
- [ ] 4.4 빠른 연속 드롭(디바운스/중복 방지) 동작 확인
- 검증: 예제 26/27 수행 중 UI 수동 점검(그래프/오버레이 동작 무결성)

세부 작업
- [ ] F.1 예제 27: 다수 Agent 동시 표시 환경에서 각자 독립 동작 확인
- [ ] F.2 예제 26: 팀 포크/조인 상태에서 타겟팅 정확성 및 간섭 없음 확인
- [ ] F.3 툴 파생 서브 플로우 유무에 따른 일관 동작 확인

실현가능성: 85%
- 근거: 다양한 케이스 수동 검증이 필요하고, 레이아웃/순서 민감도 존재

### 4단계: 에이전트 타겟 식별 정확화
- [x] `agentId` 추출 기준 명확화: 노드 `id` 또는 `data.sourceId`
- [x] 추출 표준 함수 `extractAgentId(node)` 유지/활용
- 검증: 다양한 예제(싱글/팀)에서 올바른 에이전트로 추가되는지 눈검증

세부 작업
- [x] G.1 `extractAgentId(node)` 표준화: `data.sourceId` 우선, 없으면 `node.id`
- [x] G.2 관련 호출부 일관 적용

실현가능성: 96%
- 근거: 단순 규칙 통일 작업

### 5단계(후속): 실제 Agent Config 반영(설계만)
- [ ] 구성 변경 지점 정의: 실행 전/실행 중 UI에서 편집 → 컨텍스트/드래프트 config에 merge
- [ ] 타입 안전성: 기존 AgentConfig 타입과 합치도록 인터페이스 확정
- [ ] 소스오브트루스 훼손 금지: SDK에서 제공한 `workflow`는 불변, 별도 config 작성 후 적용
- 검증: 실행 시 해당 Tool이 실제로 사용 가능한지(후속 작업)

### 6단계: 에이전트 인스턴스 레지스트리(웹 브릿지)
- [x] `apps/web/src/lib/playground/robota-executor.ts`에 레지스트리 추가: `conversationId(rootId) → agentInstance`
- [x] 표준 추출 함수 `extractAgentId(node)`를 사용하여 노드→rootId 해석
- [x] 브릿지 메서드 초안:
  - `updateAgentTools(agentId: string, tools: ToolDefinition[]): Promise<void>`
  - `getAgentConfiguration(agentId: string): Promise<{ version: number; tools: ToolSummary[]; updatedAt: number }>`
- [x] 검증: 드롭 후 업데이트/조회가 동일 agent 대상에 일관되게 수행되는지 확인

## 4. 상세 DnD 인터랙션 설계
- 드래그 진입(enter): Agent 노드 외곽선/배경 강조(예: `ring-2 ring-blue-400 bg-blue-50/40`)
- 드래그 유지(over): `preventDefault()`로 드롭 가능 상태 유지, 내부에 가이드 텍스트 옵션
- 드래그 이탈(leave): 강조 제거
- 드롭(drop): 데이터 파싱 → 상위 콜백 호출 → UI 오버레이 상태 갱신 → 강조 제거

## 5. 타입/상태 정의(초안)
```ts
type AgentId = string;

interface ToolItem { id: string; name: string; description?: string; parameters?: Record<string, unknown>; }

type AddedToolsByAgent = Record<AgentId, string[]>; // UI overlay only

interface WorkflowVisualizationProps {
  workflow?: UniversalWorkflowStructure;
  onAgentNodeClick?: (agentId: string, data: any) => void;
  onToolDrop?: (agentId: string, tool: ToolItem) => void; // new
  addedToolsByAgent?: AddedToolsByAgent; // new
}
```

## 6. 검증 계획
- 기능 검증(수동):
  - 툴 카드 드래그 → Agent 노드 하이라이트 → 드롭 → 해당 Agent에 뱃지 추가
  - 동일 툴 중복 드롭 시 1회만 추가되는지 확인
  - 우측 Tools 목록에서 추가한 신규 툴도 동일 흐름으로 동작
- 회귀 검증:
  - React Flow 캔버스 높이/레이아웃 유지
  - 기존 예제(26/27) 데이터 렌더링/구독에 영향 없음

## 7. UI 병합 표시 기준(배열 기반)
- 기본: SDK에서 온 `data.tools`(배열)와 UI 오버레이 `addedToolsByAgent[agentId]`(배열)를 병합하여 표시
- 병합 규칙:
  - 이름 기준 중복 제거(대소문자 무시)
  - 순서: SDK 도구 우선, 이후 오버레이 도구 추가
  - 제거 UI가 생길 때까지 오버레이는 표시 유지

## 8. 제외 범위(현재 단계)
- 실행 중 동시성/충돌 제어: 추후 고려
- 되돌리기/영속화: 추후 범위

### 6.1 혼재 플로우 전용 체크
- [ ] 여러 에이전트 노드가 동시에 화면에 있을 때, 올바른 노드만 드롭 반응 및 추가 처리
- [ ] 다른 플로우(팀/툴 파생)의 Agent에 드롭해도 서로 상태 충돌 없음

## 7. 비기능 요구사항
- 성능: DnD/오버레이 계산은 O(1)~O(n) 수준 경량 처리, 렌더 최소화
- 접근성: 포커스/키보드 대안(후속), 툴팁 제공
- 로그: 개발 모드에서만 콘솔 로그, 배포 모드 최소화

## 8. 리스크 및 대응
- 에이전트 식별 혼동: `id`/`sourceId` 혼재 → `extractAgentId` 표준화로 완화
- 중복 추가: `Set` 기반 또는 배열+검사로 방지
- 훅 규칙 위반: 하위 컴포넌트에서만 상태 사용, 조건부 훅 호출 금지

## 9. 수용 기준(Acceptance Criteria)
- [ ] 드래그 시 Agent 노드가 확실히 시각적 반응
- [ ] 드롭 시 해당 Agent에 툴 뱃지가 즉시 추가(중복 없음)
- [ ] Tools 목록에 새 툴 추가 후 동일 동작 가능
- [ ] Workflow 렌더/구독/경로 규칙에 영향 없음(Path-Only 보존)
- [ ] 코드 스타일/훅 규칙/이벤트 소유권 위반 없음

---

작성자 메모: 본 문서는 UI 단계의 설계 계획입니다. "실제 Agent Config 반영"은 후속 단계에서 별도 문서/PR로 진행합니다.

## 10. 툴 메타데이터 및 로컬 구현(AssignTask 우선)

- 목표: 사이드바 Tool 목록은 메타데이터(카탈로그) 기반으로 렌더링. 실제 Tool 구현은 환경별(mcp/openapi/zod 등)로 존재할 수 있으며, 웹 환경에서는 직접 연결이 어려우므로 래퍼/어댑터 계층을 둔다. 초기 단계에서는 AssignTask 단일 예제를 apps/web 내부에서 로컬로 제공하여 흐름을 확정한다.

### 10.1 디렉터리 구조(초안)
```
apps/web/src/tools/
  assign-task/
    index.ts        // 메타정의 + UI 어댑터(웹에서 사용 가능한 경량 wrapper)
    README.md       // 사용 설명(내부)
```

### 10.2 메타데이터 스키마(초안)
```ts
// UI 카탈로그 항목(메타)
export interface PlaygroundToolMeta {
  id: string;                 // 'assignTask'
  name: string;               // 'AssignTask'
  type?: 'zod' | 'mcp' | 'openapi' | 'builtin';
  description?: string;
  tags?: string[];
  // (선택) 실행에 필요한 최소 파라미터 스펙 요약(문서용)
  parametersSummary?: Array<{ name: string; type: string; required?: boolean; description?: string }>
}

// 카탈로그 로더(정적)
export function getPlaygroundToolCatalog(): PlaygroundToolMeta[] {
  return [
    {
      id: 'assignTask',
      name: 'AssignTask',
      type: 'builtin',
      description: 'Delegate a task to another agent (demo in web sandbox).'
    }
  ];
}
```

### 10.3 UI 연동 규칙(초안)
- 사이드바는 `getPlaygroundToolCatalog()`를 호출해 정적 목록을 렌더링한다(동적 import 금지, 정적 의존성만 허용).
- 드래그 데이터는 기존과 동일하게 `{ id, name, description }` JSON으로 전달한다.
- 드롭 시 현재 단계에서는 `executor.updateAgentToolsFromCard(agentId, toolMeta)`를 호출하여 UI-전용 Dummy Tool을 추가한다.
  - 추후: 실제 assignTask 실행 가능 경로로 교체(통합 툴 팩토리/어댑터 연결).

### 10.4 향후 확장(설계만)
- MCP/OpenAPI/Zod 각각에 대해 어댑터 계층을 둔다.
  - MCP: 브라우저 한계 고려하여 웹-호환 래퍼 설계, 원격 브릿지 필요 시 Remote Transport 고려
  - OpenAPI: 사전 생성된 클라이언트 또는 경량 호출 래퍼(정적 import)
  - Zod: 기존 `createZodFunctionTool`과의 호환 지점 정의
- 통합 툴 팩토리와 연결: `kind` 기반 위임으로 실제 Tool 인스턴스 생성/업데이트 가능하게 확장

### 10.5 체크리스트
- [ ] apps/web에 `src/tools/assign-task/` 생성
- [ ] `index.ts`에 `PlaygroundToolMeta`와 `getPlaygroundToolCatalog()` 구현(정적 반환)
- [ ] 사이드바에서 카탈로그를 사용하도록 교체
- [ ] 드롭 시 메타 → 기존 브릿지 호출 연결 유지(현재 Dummy Tool 추가)
- [ ] 추후 MCP/OpenAPI 어댑터 설계 문서 초안 추가

## 11. 단계별 세부 계획 (P0~P4)

### P0: AssignTask 스캐폴딩(최우선)
- [x] apps/web/src/tools/assign-task/index.ts 생성
  - [x] `PlaygroundToolMeta`와 `createAssignTaskTool` export
  - [x] Zod 스키마(파라미터는 팀 assignTask와 동일 의미)
  - [x] 더미 executor (구현은 마지막으로 미룸)
- [x] apps/web/src/tools/catalog.ts 생성
  - [x] `getPlaygroundToolCatalog()` 정적 카탈로그 반환 (동적 import 금지)
  - [x] `ToolRegistry: Record<string, () => BaseTool>` 등록 (id→생성자)
  - [x] id 충돌 방지 및 누락 시 명시적 에러 throw

### P1: 사이드바 메타데이터 전환
- [x] apps/web/src/app/playground/page.tsx
  - [x] 기존 하드코딩 `toolItems` 제거
  - [x] `getPlaygroundToolCatalog()` 호출하여 목록 렌더
  - [x] DnD 데이터 포맷 `{ id, name, description }`로 통일 (카탈로그 기준)
  - [x] UI 표시명/설명은 메타에서 사용

### P2: 브릿지/레지스트리 연동(메타→툴 인스턴스)
- [x] apps/web/src/lib/playground/robota-executor.ts
  - [x] `updateAgentToolsFromCard(agentId, toolMeta)`에서 기존 `buildDummyTool` 제거
  - [x] `ToolRegistry[toolMeta.id]()`로 툴 인스턴스 생성
  - [x] `existing = agent.getConfiguration().tools` 병합 후 `agent.updateTools([...existing, newTool])`
  - [x] 실패 시 명시적 에러 전파(침묵/대체 금지)
  - [x] 성공 시 `agent.config_updated` 흐름을 통해 UI 반영 (기존 경로 유지)

### P3: UI/DnD 확인 (조용한 반영)
- [ ] apps/web/src/components/playground/workflow-visualization.tsx
  - [ ] AgentNode DnD 하이라이트/드롭 정상 동작 재확인
  - [ ] `onToolDrop` → 페이지 → executor 경로 호출 확인
  - [ ] 스냅샷 전체 교체 렌더로 즉시 반영 확인 (progressive reveal 미사용)
- [ ] 알림/디버그 로그 최소화 (개발 모드 외 노이즈 금지)

### P4: 검증 (기능/빌드)
- [ ] 기능 수동 검증
  - [ ] 사이드바 AssignTask 표시 → 에이전트 노드로 드롭 → 에이전트 노드 뱃지 증가
  - [ ] 스냅샷 새로고침 없이 반영(전체 교체 렌더)
- [ ] 빌드 검증
  - [ ] `pnpm --filter @robota-sdk/workflow build`
  - [ ] `cd apps/web && pnpm build`
- [ ] 문서 동기화
  - [ ] 본 섹션 각 항목 [x] 처리
  - [ ] 상위 로드맵(P0~P4) 상태 최신화


## 12. Rule Compliance Review & Adjustments

본 계획이 프로젝트 규칙을 준수하는지 면밀히 점검하고, 필요한 보완사항을 반영합니다.

### 12.1 이벤트 소유권(Event Ownership)
- 에이전트 설정 변경은 오직 `agent.updateTools()` → `AGENT_EVENTS.CONFIG_UPDATED`로 발생 (소유자: agents)
- UI(웹)는 이벤트를 직접 발생시키지 않음. 단지 에이전트 API를 호출할 뿐임
- Tool 실행/호출에 관한 이벤트(`tool.*`)는 발생시키지 않음 (현재 단계는 설정 업데이트 전용)

조치:
- [x] P2 단계에서 `updateAgentToolsFromCard`는 `agent.updateTools()`만 호출하고 다른 이벤트를 만들지 않음

### 12.2 Path-Only 원칙
- 본 기능은 그래프 구조 생성/연결 로직에 관여하지 않음
- Workflow 업데이트는 기존 핸들러가 처리하고, UI는 스냅샷만 구독 (소스 오브 트루스 분리)

조치:
- [x] UI는 그래프를 변형/보정하지 않고 스냅샷 전체 교체 렌더만 수행
- [x] 관계 추론(ID 파싱/regex) 금지. `agentId`는 명시적 필드(`data.sourceId` 또는 `node.id`)만 사용

### 12.3 No-Fallback / 명시적 에러
- 누락된 레지스트리/카탈로그 항목은 조용히 통과하지 않고 명시적 에러로 처리
- 대체 경로/임시 처리/지연 처리 금지

조치:
- [x] P2에서 `ToolRegistry[toolMeta.id]`가 없으면 예외 throw (UI에서 오류 표시만 수행)

### 12.4 정적 import / 동적 import 금지
- 툴 카탈로그, 레지스트리, assignTask 구현은 **정적 import**만 사용
- 런타임 `await import()` 사용 금지

조치:
- [x] `apps/web/src/tools/catalog.ts`는 정적 등록/정적 내보내기만 수행

### 12.5 도메인 중립성 / 책임 분리
- 툴 메타는 UI 카탈로그(표시/선택/드래그) 책임만 가짐
- 실제 툴 인스턴스는 웹 래퍼에서 생성하되, 인터페이스는 SDK의 `BaseTool`에 준수
- 이벤트/그래프 처리 책임은 SDK(agents/workflow)에 국한

조치:
- [x] `apps/web/src/tools/assign-task/`는 UI-호출 가능한 래퍼 수준(더미 executor)로 제한
- [x] 그래프 관련 로직/핸들러는 수정하지 않음

### 12.6 확장성(Registry/Adapter)
- 카탈로그는 메타만, 레지스트리는 id→생성자 매핑으로 확장
- MCP/OpenAPI/Zod 등 각 어댑터는 후속 단계에서 독립 모듈로 추가 가능

조치:
- [x] `ToolRegistry`는 정적 매핑 구조로 시작하고, 모듈 분리/확장 용이

### 12.7 빌드 규칙
- 패키지 수정 시 빌드 필수. 현재 변경 범위는 apps/web과 문서에 국한 (패키지 빌드 영향 없음)

조치:
- [x] 패키지 수정 없는 범위에서 진행. 패키지 수정 시 `pnpm --filter` 빌드 수행

### 12.8 단계별 보완 반영(요구사항 반영)
- P0/P1/P2 단계 항목에 아래 보강 문구를 추가
  - “정적 import만 사용(동적 import 금지)”
  - “누락/미등록 id는 명시적 에러 throw(침묵/대체 금지)”
  - “UI는 이벤트 생성 금지, 에이전트 API만 호출”
  - “그래프는 스냅샷 기반 전체 교체 렌더만 수행(수정/재배치 금지)”

[x] P0/P1/P2 섹션의 구현 시 이 보완 문구 체크 반영 (구현 직후 [x] 처리)


## 13. Dual-Case Compatibility & Mandatory Verification

두 가지 케이스가 동시에 정상 동작해야 하며, 하나의 수정이 다른 쪽을 깨뜨리면 안 됩니다.

### 13.1 케이스 정의
- Case A (기존) — Example 26: team의 서드파티 `assignTask`가 에이전트를 생성하는 특수 도구
  - 기대: 기존 26번 예제는 변경 없이 그대로 실행되어야 함
  - 이벤트: team/assignTask 특성상 에이전트 생성이 뒤따를 수 있음(legacy third-party)
- Case B (신규) — Dummy AssignTask: 단순 툴 호출만 수행, 에이전트 생성 없음
  - 기대: tool.call_start → tool.call_response_ready/complete → execution.tool_results_ready → response로 자연 연결

### 13.2 핸들러 설계 원칙(두 케이스 공통)
- 이벤트 소유권 준수: `tool.*`은 툴에서만, `execution.*`은 ExecutionService에서만, `agent.*`은 에이전트에서만
- Path-Only 연결: `event.path`/명시적 필드만으로 연결. ID 파싱/추론/보조상태/지연/대체 금지
- 도구 특수처리 금지: 핸들러는 특정 도구명을 하드코딩하지 않음 (assignTask 전용 로직 금지)
- 스냅샷 원자성: 이벤트 단위로 모든 업데이트 적용 후 1회 스냅샷 발행(이미 반영)

### 13.3 변경 시 필수 검증 순서(가드)
- 어떤 수정이든 아래 순서로 실행/검증(실패 시 중단 및 원복)
  1) 신규 더미 예제 실행(예: 29-assign-task-tool-call-check.ts)
  2) Example 26 실행 (변형 없이)
  3) 검증 스크립트 실행(`apps/examples/utils/verify-workflow-connections.ts`)

권장 명령(가드 패턴):
```bash
cd /Users/jungyoun/Documents/dev/robota/apps/examples && \
FILE=29-assign-task-tool-call-check.ts && \
HASH=$(md5 -q "$FILE") && \
OUT=cache/29-assign-task-$HASH-guarded.log && \
echo "▶️ Run dummy assignTask example (guarded)..." && \
STATUS=0; npx tsx "$FILE" > "$OUT" 2>&1 || STATUS=$?; \
tail -n 160 "$OUT" | cat; \
if [ "$STATUS" -ne 0 ] || grep -E "\\[STRICT-POLICY\\]|\\[EDGE-ORDER-VIOLATION\\]" "$OUT" >/dev/null; then \
  echo "❌ Aborting (dummy example failed or strict-policy violation)."; \
  exit ${STATUS:-1}; \
fi; \
FILE2=26-playground-edge-verification.ts && \
HASH2=$(md5 -q "$FILE2") && \
OUT2=cache/26-playground-$HASH2-guarded.log && \
echo "▶️ Run example 26 (guarded)..." && \
STATUS2=0; npx tsx "$FILE2" > "$OUT2" 2>&1 || STATUS2=$?; \
tail -n 160 "$OUT2" | cat; \
if [ "$STATUS2" -ne 0 ] || grep -E "\\[STRICT-POLICY\\]|\\[EDGE-ORDER-VIOLATION\\]" "$OUT2" >/dev/null; then \
  echo "❌ Aborting (example 26 failed or strict-policy violation)."; \
  exit ${STATUS2:-1}; \
fi; \
echo "▶️ Verify connections..." && \
npx tsx utils/verify-workflow-connections.ts | cat
```

### 13.4 수용 기준(추가)
- [ ] Case B 더미 예제 정상 동작, 예상 노드/엣지 시퀀스 생성(툴 응답 → 결과 → 응답)
- [ ] Case A Example 26 기존 결과 변형 없음
- [ ] 검증 스크립트 통과(두 케이스 모두) — 위 가드 명령 기준
- [ ] 핸들러에 도구 특수처리 코드 없음(이벤트 상수만 사용, 하드코딩 금지)

### 13.5 개발 수칙(추가)
- [ ] 변경 전/후 항상 P3/P4 검증 루틴 실행
- [ ] 실패 시 즉시 중단, 원인 분석 후 설계 보완 → 재시도
- [ ] 문서 체크박스 최신 상태 유지(P5~P9 진행 시)

