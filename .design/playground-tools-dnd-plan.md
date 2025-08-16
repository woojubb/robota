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
- [P1] 코어(agents/workflow): 에이전트 툴 설정 업데이트 기능 확립 (가장 먼저)
  - [ ] AGENT_EVENTS.CONFIG_UPDATED 상수 추가(기존 AGENT_EVENTS 선언 파일)
  - [ ] Robota 메서드 추가: `updateTools`, `updateConfiguration`, `getConfiguration`
  - [ ] AgentEventHandler: `CONFIG_UPDATED` 처리(노드 데이터 업데이트만)
- [P2] 웹 브릿지: 에이전트 인스턴스 접근/호출 경로 마련
  - [ ] executor 레지스트리: `rootId → agentInstance`
  - [ ] bridge 메서드: `updateAgentTools`, `getAgentConfiguration`
- [P3] UI: DnD → 브릿지 호출 → 반영 표시(오버레이)
  - [ ] Tools 카드 DnD 완성, Agent 노드 하이라이트/드롭 처리
  - [ ] 오버레이 병합 뱃지 표시(배열 병합 규칙)
  - [ ] 실패/성공 알림
- [P4] 문서/검증: 혼재 플로우/경계 조건 점검
  - [ ] 예제 26/27 교차 검증, 중복 추가 방지, 연속 드롭 케이스 확인

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
  kind: string;                      // 예: "assignTask", "webSearch"
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
- 목적: 기존 개별 툴 팩토리들은 유지하되, 하나의 통합 팩토리에서 `kind` 기반으로 위임하여 Tool 인스턴스를 생성
- 도메인 중립, 정적 매핑, 엄격한 검증/에러 정책

#### API 초안
```ts
namespace UnifiedToolFactory {
  // 단일 항목 생성
  export function create(config: ToolConfig): Tool;

  // 다중 항목 생성(정렬/중복 제거 포함)
  export function createMany(configs: ToolConfig[]): Tool[];

  // (선택) 앱 초기화 시 확장 등록 - 런타임 동적 import 금지, 정적 함수만 연결
  export function register(kind: string, builder: (cfg: ToolConfig) => Tool): void;
}
```

#### 동작 규칙
- 매핑 규칙: `kind` → 기존 개별 팩토리(예: `assignTask` → `AssignTaskFactory.fromConfig`, `webSearch` → `WebSearchFactory.fromConfig`)
- 검증: 각 개별 팩토리에서 스키마 검증 수행, 실패 시 예외 throw(침묵/대체 경로 금지)
- 중복 제거: `name || kind`를 key로 하여 case-insensitive 중복 제거(우선 첫 번째 유지)
- 순서: 입력 순서 안정성 유지(중복 제거 이후 상대적 순서 보존)
- 매핑 누락: 등록되지 않은 `kind`는 명시적 에러(지원하지 않는 도구)
- 동적 확장: `register`는 앱 초기화 시점에서만 호출(핫 런타임 등록 금지)

#### 예시 구현 스케치
```ts
const registry: Record<string, (cfg: ToolConfig) => Tool> = {
  assignTask: AssignTaskFactory.fromConfig,
  webSearch: WebSearchFactory.fromConfig,
  // ... statically wired
};

export function create(config: ToolConfig): Tool {
  const builder = registry[config.kind];
  if (!builder) throw new Error(`[UnifiedToolFactory] Unknown kind: ${config.kind}`);
  return builder(config);
}

export function createMany(configs: ToolConfig[]): Tool[] {
  const seen = new Set<string>();
  const result: Tool[] = [];
  for (const cfg of configs) {
    const key = (cfg.name || cfg.kind).toLowerCase();
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
- [ ] 1.1 AGENT_EVENTS.CONFIG_UPDATED 상수 추가(소유: agents)
- [ ] 1.2 Robota에 `updateTools(next)`, `updateConfiguration(patch)`, `getConfiguration()` 추가
- [ ] 1.3 유효성 오류 시 예외 throw, 성공 시 `{ version }` 반환
- [ ] 1.4 AgentEventHandler: `CONFIG_UPDATED` 처리(해당 agent 노드의 `data.tools`/`data.configVersion`만 update)
- 검증: 이벤트 하드코딩 금지, 소유권/Path-Only 준수, 노드/엣지 생성 금지 확인

세부 작업
- [ ] A.1 `packages/agents/src/agents/constants.ts`에 `CONFIG_UPDATED` 상수 추가 및 `index.ts` 재수출
- [ ] A.2 `Robota` 클래스에 내부 config 상태(version, updatedAt) 보관 필드 추가
- [ ] A.3 `updateTools(next: ToolDefinition[])` 구현: 입력 검증 → 내부 ToolManager 갱신 → version++ → `CONFIG_UPDATED` emit
- [ ] A.4 `updateConfiguration(patch: AgentConfigPatch)` 구현: partial merge → 동일 프로세스
- [ ] A.5 `getConfiguration()` 구현: `{ version, tools: ToolSummary[], updatedAt, metadata }` 반환
- [ ] A.6 `packages/workflow/src/handlers/agent-event-handler.ts`에서 `CONFIG_UPDATED` 케이스 추가: 해당 agent 노드 `data.tools`/`data.configVersion` 업데이트만 수행
- [ ] A.7 타입/주석/문서화 보강(언어 규칙 준수)

실현가능성: 90%
- 근거: 기존 이벤트/핸들러 패턴에 부합하며, 구조 변경 없이 업데이트만 수행

### 2단계 [P2]: 브릿지/레지스트리(웹)
- [ ] 2.1 executor 레지스트리: `conversationId(rootId) → agentInstance` 맵 도입
- [ ] 2.2 메서드: `updateAgentTools(agentId, tools)`, `getAgentConfiguration(agentId)`
- [ ] 2.3 `extractAgentId(node)`로 식별 표준화
- 검증: 브릿지 경로를 통해 코어 메서드 호출/응답 정상

세부 작업
- [ ] B.1 `apps/web/src/lib/playground/robota-executor.ts`에 레지스트리 필드 및 CRUD 추가
- [ ] B.2 Agent/Team 생성 시점에 레지스트리 등록/해제 로직 연결
- [ ] B.3 `updateAgentTools` → 인스턴스 조회 → `agent.updateTools()` 호출 → 성공/실패 결과 반환
- [ ] B.4 `getAgentConfiguration` → 인스턴스 조회 → `agent.getConfiguration()` 반환
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
- [ ] 2.1 카드 `dragstart`: `dataTransfer.setData('application/robota-tool', json)` 구현
- [ ] 2.2 캔버스 래퍼 `onDragOver`에서 `preventDefault()`(드롭 허용)
- [ ] 2.3 AgentNode에 `dragenter`/`dragover`/`dragleave`/`drop` 바인딩
- [ ] 2.4 드래그 진입 시 하이라이트 on, 이탈 시 off(타임아웃/중복 이벤트 대비)
- [ ] 2.5 `drop`에서 JSON 파싱과 에러 처리(try/catch, 불량 데이터 무시)
- [ ] 2.6 상위 콜백 `__onToolDrop(agentId, tool)` 호출 규약 확정
- [ ] 2.7 드롭 완료 후 하이라이트 off 및 기본 이벤트 취소
- 검증: 콘솔 로그로 Agent/Tool 페이로드 확인, 하이라이트 토글 정확성 점검

세부 작업
- [ ] D.1 AgentNode에 드래그 이벤트 바인딩 및 하이라이트 클래스 구현
- [ ] D.2 드롭 데이터 파싱/검증 → 상위 콜백 `__onToolDrop` 호출
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
- [ ] `agentId` 추출 기준 명확화: 노드 `id` 또는 `data.sourceId`
- [ ] 추출 표준 함수 `extractAgentId(node)` 유지/활용
- 검증: 다양한 예제(싱글/팀)에서 올바른 에이전트로 추가되는지 눈검증

세부 작업
- [ ] G.1 `extractAgentId(node)` 표준화: `data.sourceId` 우선, 없으면 `node.id`
- [ ] G.2 관련 호출부 일관 적용

실현가능성: 96%
- 근거: 단순 규칙 통일 작업

### 5단계(후속): 실제 Agent Config 반영(설계만)
- [ ] 구성 변경 지점 정의: 실행 전/실행 중 UI에서 편집 → 컨텍스트/드래프트 config에 merge
- [ ] 타입 안전성: 기존 AgentConfig 타입과 합치도록 인터페이스 확정
- [ ] 소스오브트루스 훼손 금지: SDK에서 제공한 `workflow`는 불변, 별도 config 작성 후 적용
- 검증: 실행 시 해당 Tool이 실제로 사용 가능한지(후속 작업)

### 6단계: 에이전트 인스턴스 레지스트리(웹 브릿지)
- [ ] `apps/web/src/lib/playground/robota-executor.ts`에 레지스트리 추가: `conversationId(rootId) → agentInstance`
- [ ] 표준 추출 함수 `extractAgentId(node)`를 사용하여 노드→rootId 해석
- [ ] 브릿지 메서드 초안:
  - `updateAgentTools(agentId: string, tools: ToolDefinition[]): Promise<void>`
  - `getAgentConfiguration(agentId: string): Promise<{ version: number; tools: ToolSummary[]; updatedAt: number }>`
- 검증: 드롭 후 업데이트/조회가 동일 agent 대상에 일관되게 수행되는지 확인

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

