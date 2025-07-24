# Robota Playground Implementation Roadmap

## 🎯 **목표: Plugin 기반 Visual Configuration & History Visualization Playground**

Robota SDK의 기존 Plugin System과 RemoteExecutor를 활용하여 브라우저에서 실제 Robota Agent를 실행하고 시각화하는 Playground 구현.

---

## 📋 **Phase 1: Core Infrastructure (1주)**

### **1.1 PlaygroundHistoryPlugin 개발**
- [ ] `PlaygroundHistoryPlugin` 클래스 생성 (`apps/web/src/lib/playground/plugins/`)
  - [ ] `BasePlugin` 상속 및 기본 구조 구현
  - [ ] Plugin 메타데이터 정의 (`name`, `version`, `category`, `priority`)
  - [ ] 데이터 저장 구조 설계 (`ConversationNode[]`, `TeamHistory`, `AgentDelegation`)
- [ ] Robota Lifecycle Hook 구현
  - [ ] `override async beforeExecution(context: BaseExecutionContext)`
  - [ ] `override async afterExecution(context: BaseExecutionContext, result: BaseExecutionResult)`
  - [ ] `override async beforeToolCall(toolName: string, parameters: ToolParameters)`
  - [ ] `override async afterToolCall(toolName: string, result: ToolExecutionResult)`
  - [ ] `override async onMessageAdded(message: Message)`
  - [ ] `override async onStreamingChunk(chunk: StreamingChunk)`
  - [ ] `override async onModuleEvent(event: ModuleEvent)`
- [ ] Team 전용 Hook 구현
  - [ ] `onAgentDelegation(delegation: AgentDelegation)` - Team Agent 간 작업 위임
  - [ ] `onTeamCommunication(communication: TeamCommunication)` - Agent 간 통신
- [ ] 데이터 수집 및 정리
  - [ ] 대화 히스토리 수집 및 구조화
  - [ ] Tool 호출 과정 상세 기록 (input, output, duration, status)
  - [ ] Team workflow 추적 (Agent tree, delegation flow)
  - [ ] 실시간 이벤트 수집 및 버퍼링

### **1.2 WebSocket Integration**
- [ ] `apps/api-server`에 WebSocket 서버 추가
  - [ ] `ws` 또는 `socket.io` 의존성 추가
  - [ ] WebSocket connection 관리 (`/ws/playground` endpoint)
  - [ ] User authentication via JWT token 검증
  - [ ] Connection pool 관리 (user별 connection tracking)
- [ ] `PlaygroundHistoryPlugin`에 WebSocket 클라이언트 연결
  - [ ] `syncToUI(data: PlaygroundVisualizationData)` 메서드 구현
  - [ ] 실시간 이벤트 전송 (message, tool_call, delegation 등)
  - [ ] Connection 재연결 로직
  - [ ] Error handling 및 fallback

### **1.3 Remote Executor 강화**
- [ ] `SimpleRemoteExecutor` WebSocket 지원 추가
  - [ ] WebSocket transport option (`protocol: 'websocket'`)
  - [ ] HTTP fallback 유지 (기존 기능 보존)
  - [ ] Real-time streaming via WebSocket
- [ ] Playground 전용 인증 시스템
  - [ ] `apps/api-server`에 Playground token 검증 미들웨어
  - [ ] Firebase Auth JWT → API Server JWT 교환
  - [ ] Rate limiting (Playground 사용자별)
  - [ ] Session 관리 및 cleanup

---

## 📋 **Phase 2: Frontend Infrastructure (1주)**

### **2.1 Robota Browser Integration**
- [ ] `apps/web/src/lib/playground/robota-executor.ts` 생성
  - [ ] `PlaygroundExecutor` 클래스 구현
  - [ ] Robota Agent 인스턴스 관리 (Single Agent, Team 모드)
  - [ ] Plugin injection (`PlaygroundHistoryPlugin`, `ConversationHistoryPlugin`, `UsagePlugin`, `PerformancePlugin`)
  - [ ] RemoteExecutor를 aiProviders로 설정
- [ ] WebSocket 클라이언트 구현
  - [ ] `apps/web/src/lib/playground/websocket-client.ts`
  - [ ] 실시간 Plugin 데이터 수신
  - [ ] UI state 동기화 (React Context)
  - [ ] Connection status 관리
  - [ ] Automatic reconnection

### **2.2 Data Models & Types**
- [ ] `apps/web/src/types/playground.ts` 확장
  - [ ] `ConversationNode` interface (message, tool_call, tool_result, agent_id)
  - [ ] `AgentHistory` interface (timeline, statistics)
  - [ ] `TeamHistory` interface (agent_tree, delegations, communications)
  - [ ] `ToolCallVisualization` interface (input/output parameters, execution status)
  - [ ] `PlaygroundVisualizationData` interface (통합 데이터 구조)
- [ ] React Context 및 Hooks
  - [ ] `PlaygroundContext` - 전역 상태 관리
  - [ ] `usePlaygroundData()` - Plugin 데이터 접근
  - [ ] `useRobotaExecution()` - Agent 실행 상태
  - [ ] `useWebSocketConnection()` - 연결 상태 관리
  - [ ] `useChatInput()` - 실시간 채팅 입력 및 전송 관리

---

## 📋 **Phase 3: Visual Configuration System (1주)**

### **3.1 Agent Structure Display Components**
- [ ] `AgentConfigurationBlock` 컴포넌트
  - [ ] Provider selection visual block
  - [ ] System message configuration block
  - [ ] Model parameters (temperature, maxTokens) visual editor
  - [ ] Real-time configuration validation
- [ ] `ToolContainerBlock` 컴포넌트
  - [ ] Tool 목록 block 표시
  - [ ] `ToolItemBlock` - tool name, description, parameters detail
  - [ ] Parameter schema 시각화 (name, type, required, description, example)
  - [ ] Drag & Drop으로 tool 추가/제거
- [ ] `PluginContainerBlock` 컴포넌트
  - [ ] Plugin 목록 및 status 표시
  - [ ] `PluginItemBlock` - plugin name, enabled status, configuration
  - [ ] Plugin 별 visual indicator (로깅, 사용량, 성능 등)

### **3.2 Team Structure Display Components**
- [ ] `TeamConfigurationBlock` 컴포넌트
  - [ ] Team hierarchy visualization
  - [ ] Agent 간 workflow connection 표시
  - [ ] `ConnectionLine` - Agent 간 relationship 시각화
- [ ] `AgentContainerBlock` (Team 내 개별 Agent)
  - [ ] Team 내 각 Agent의 role 및 configuration
  - [ ] Agent 간 delegation rules 시각화
  - [ ] Workflow configuration block

### **3.3 Configuration Generator**
- [ ] UI → Robota Config 변환 엔진
  - [ ] `generateAgentCode(uiConfig: UIConfiguration): string`
  - [ ] `generateTeamCode(teamConfig: TeamConfiguration): string`
  - [ ] 실시간 코드 생성 및 미리보기
- [ ] Configuration validation
  - [ ] Required field 검증
  - [ ] Provider compatibility 체크
  - [ ] Model availability 확인

---

## 📋 **Phase 4: History Visualization System (1주)**

### **4.1 Single Agent Timeline**
- [ ] `AgentTimelineBlock` 컴포넌트
  - [ ] Message flow visualization (user → assistant → tool → assistant)
  - [ ] Timeline 기반 conversation flow
  - [ ] Message content preview 및 확장
- [ ] `ToolCallBlock` 컴포넌트
  - [ ] Tool 호출 상세 정보 (name, input parameters, output result)
  - [ ] Execution status indicator (pending, success, error)
  - [ ] Duration 및 performance metrics
  - [ ] Expandable detail view

### **4.2 Team Chat Visualization**
- [ ] `TeamTimelineBlock` 컴포넌트
  - [ ] Multi-agent conversation lanes
  - [ ] Agent 별 timeline 분리 표시
  - [ ] Cross-agent communication 시각화
- [ ] `DelegationBlock` 컴포넌트
  - [ ] Agent 간 task delegation 표시
  - [ ] Delegation 이유 및 결과 시각화
  - [ ] Workflow depth indicator
- [ ] `CommunicationBlock` 컴포넌트
  - [ ] Agent 간 직접 통신 내역
  - [ ] Communication type (delegation, coordination, result sharing)

### **4.3 Interactive Chat & Real-time Execution** ⭐ **핵심 기능**
- [ ] **Live Chat Interface**
  - [ ] 프롬프트 입력 UI (Agent/Team 모드 구분)
  - [ ] "Send Message" 버튼 및 Enter 키 지원
  - [ ] Chat input validation 및 전송 상태 표시
- [ ] **Real-time Block Updates**
  - [ ] 사용자 메시지 → 즉시 Timeline에 추가
  - [ ] Agent 응답 → 실시간 스트리밍으로 Block 업데이트
  - [ ] Tool 호출 → 진행 상태 및 결과를 실시간 Block으로 표시
  - [ ] Team delegation → Agent 간 작업 위임 Block 실시간 생성
- [ ] **WebSocket Real-time Sync**
  - [ ] PlaygroundHistoryPlugin → WebSocket → UI 실시간 동기화
  - [ ] 메시지, Tool call, Team communication 모든 이벤트 실시간 반영
  - [ ] Streaming response의 각 chunk를 실시간으로 UI에 표시
- [ ] **Interactive Controls**
  - [ ] 대화 중 Stop/Cancel 버튼
  - [ ] 진행 중인 tool call 상태 표시
  - [ ] Agent/Team 전환 without 대화 내역 손실
- [ ] **History Navigation & Management**
  - [ ] Timeline scrubber (특정 시점으로 이동)
  - [ ] Message filtering (tool calls only, errors only 등)
  - [ ] Clear history / New conversation
  - [ ] Export functionality (JSON, 텍스트 형태)

---

## 📋 **Phase 5: Code Generation & Export (3일)**

### **5.1 Robota Code Generator**
- [ ] `RobotaCodeGenerator` 클래스 구현
  - [ ] UI 설정 → 실제 Robota SDK 코드 변환
  - [ ] Plugin imports 자동 생성
  - [ ] Tool definitions 포함
  - [ ] 완전히 실행 가능한 코드 생성
- [ ] Template system
  - [ ] Single Agent template
  - [ ] Team collaboration template
  - [ ] Custom plugin configuration template
- [ ] Code export features
  - [ ] Copy to clipboard
  - [ ] Download as .ts file
  - [ ] Project template 생성 (package.json 포함)

### **5.2 Live Configuration Sync**
- [ ] UI 변경 → 실시간 Robota instance 업데이트
  - [ ] Configuration change detection
  - [ ] Agent 재구성 without 재시작
  - [ ] Plugin configuration hot reload
- [ ] Plugin-Enhanced Export
  - [ ] Plugin 설정 포함 완전한 프로젝트 export
  - [ ] Environment variables template
  - [ ] Installation guide 자동 생성

---

## 📋 **Phase 6: UI/UX Integration (1주)**

### **6.1 Three-Panel Layout Implementation**
- [ ] Layout restructuring
  - [ ] Left Panel: Agent Structure Display
  - [ ] Center Panel: Chat History Visualization + **Live Chat Input** ⭐
  - [ ] Right Panel: Code Generation & Export
  - [ ] Chat Input Bar: 하단 고정 위치 (Agent/Team 모드별 스타일링)
  - [ ] Responsive design (모바일 대응)
- [ ] Panel interactions
  - [ ] Panel 크기 조정 (drag to resize)
  - [ ] Panel collapse/expand
  - [ ] Full-screen mode for each panel

### **6.2 Enhanced User Experience**
- [ ] Loading states
  - [ ] Agent initialization progress
  - [ ] Tool execution progress indicator
  - [ ] WebSocket connection status
- [ ] Error handling & recovery
  - [ ] Remote connection failure → Error message (Mock 제거)
  - [ ] Tool execution error visualization
  - [ ] Configuration validation error display
- [ ] Performance optimization
  - [ ] Virtual scrolling for long conversation history
  - [ ] Lazy loading for tool call details
  - [ ] WebSocket message throttling

### **6.3 Advanced Features**
- [ ] Playground sessions
  - [ ] Save/Load playground configurations
  - [ ] History persistence
  - [ ] Share playground with others
- [ ] Keyboard shortcuts
  - [ ] Quick actions (Ctrl+Enter for execute)
  - [ ] Panel navigation shortcuts
  - [ ] Copy code shortcuts

---

## 📋 **Phase 7: Testing & Polish (3일)**

### **7.1 Integration Testing**
- [ ] End-to-end testing
  - [ ] Agent configuration → execution → visualization flow
  - [ ] Team workflow testing
  - [ ] WebSocket connection testing
- [ ] Performance testing
  - [ ] Long conversation handling
  - [ ] Multiple concurrent users
  - [ ] Memory leak detection

### **7.2 Documentation & Examples**
- [ ] User guide
  - [ ] Playground 사용법 가이드
  - [ ] Agent configuration best practices
  - [ ] Team setup 예시
- [ ] Developer documentation
  - [ ] Plugin development guide
  - [ ] Architecture documentation update
  - [ ] API documentation

---

## 🚀 **Expected Timeline: 4-5주**

### **Week 1**: Phase 1-2 (Core Infrastructure + Frontend Infrastructure)
### **Week 2**: Phase 3 (Visual Configuration System)
### **Week 3**: Phase 4 (History Visualization System)
### **Week 4**: Phase 5-6 (Code Generation + UI/UX Integration)
### **Week 5**: Phase 7 (Testing & Polish)

---

## 🎯 **핵심 기술적 장점**

1. **실제 Robota Agent 사용**: 브라우저에서 완전한 Robota SDK 기능 활용
2. **Plugin 기반 확장성**: 새로운 기능을 Plugin으로 쉽게 추가
3. **Remote Execution**: 서버의 모든 AI Provider 활용 가능
4. **Real-time Visualization**: WebSocket 기반 실시간 대화 및 Tool 실행 시각화
5. **Code Generation**: 설정한 Agent를 실제 실행 가능한 코드로 export
6. **Team Support**: Multi-agent collaboration 완전 지원

이 계획은 Robota SDK의 기존 아키텍처를 100% 활용하여 최소한의 새로운 코드로 최대한의 기능을 제공합니다! 