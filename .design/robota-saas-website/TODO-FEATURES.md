# Robota SaaS 웹사이트 - 남은 구현 작업

## 📊 현재 상태 분석

### 🚀 **최근 작업 완료**

#### **Playground 코드 실행 시스템 구현** ✅
1. **템플릿 시스템 개선**:
   - 모든 예제 템플릿에서 함수 래퍼 제거 (`async function basicExample()` → 직접 실행)
   - Top-level await 지원을 위한 async IIFE 래퍼 구현
   - 브라우저 환경에 최적화 (`process.stdout.write` → `console.log`)

2. **Import 변환 시스템 구축**:
   - ES6 import statements를 global variable assignments로 변환
   - `@robota-sdk/*` 패키지들의 완전한 Mock 구현
   - `openai`, `@anthropic-ai/sdk`, `@google/generative-ai` 외부 패키지 지원
   - `process.env` Mock 객체 제공

3. **Sandbox 실행 환경**:
   - `new Function()` 기반 안전한 코드 실행
   - `console.log` 출력 캡처 및 UI 표시
   - 에러 처리 및 스택 트레이스 제공

4. **UI/UX 개선**:
   - Remote 연결 상태를 Agent Configuration 박스 외부로 이동
   - Run Code 버튼을 Code Editor 헤더로 이동
   - Execution Output을 Code Editor 근처로 배치
   - Email 인증 상태 표시 및 처리 로직 추가

#### **로컬 모드 제거** ✅
- Playground에서 로컬 모드 로직 완전 제거
- Remote 연결 실패 시 Mock fallback 대신 명확한 에러 표시
- 무조건 Remote 연결을 요구하는 정책 적용

### ✅ 완료된 Remote System 기능 (약 75% 완료)
- **패키지 구조**: `@robota-sdk/remote` 완전 구현
- **Executor 주입**: 모든 Provider (OpenAI, Anthropic, Google)에서 지원
- **API Server**: ExpressJS 기반 `/chat`, `/stream` 엔드포인트
- **클라이언트**: `SimpleRemoteExecutor`, HTTP 통신 레이어
- **테스트**: 단위 테스트 및 통합 테스트 완료

### ✅ Playground 기반 구조 (약 85% 완료)
- **코드 에디터**: Monaco Editor 통합 ✅
- **프로젝트 관리**: ProjectManager, 템플릿 시스템 ✅
- **Remote 통합**: RemoteExecutor 주입 시스템 ✅
- **인증**: Firebase Auth → Playground Token 교환 ✅
- **UI 컴포넌트**: 모든 기본 UI 컴포넌트 완성 ✅
- **템플릿 정리**: 함수 래퍼 제거, top-level await 지원 ✅
- **Import 변환**: ES6 imports → global variables 변환 시스템 ✅
- **코드 실행**: 브라우저 sandbox 환경에서 실제 코드 실행 ✅
- **Mock SDK**: `@robota-sdk/*`, `openai`, `anthropic` 등 Mock 라이브러리 ✅

## 🎯 새로운 Playground 아키텍처: Visual Configuration + History Visualization

### **1. Robota Plugin-Based System** 🎨 **[기존 인프라 활용]**

#### **1.1 Robota Browser Integration**
- [ ] **Real Robota Agent**: 브라우저에서 실제 Robota Agent 실행
  - RemoteExecutor를 통한 서버 Provider 연동
  - 기존 Plugin 시스템 전체 활용
  - EventEmitterPlugin으로 모든 이벤트 실시간 캡처
- [ ] **PlaygroundHistoryPlugin**: 새로운 Playground 전용 Plugin
  - BasePlugin 상속으로 모든 Lifecycle Hook 활용
  - WebSocket을 통한 실시간 UI 동기화
  - Team 워크플로우 추적 기능
- [ ] **Existing Plugin Integration**: 기존 Plugin들 활용
  - ConversationHistoryPlugin (대화 이력)
  - UsagePlugin (사용량 및 비용 추적)
  - PerformancePlugin (성능 모니터링)
  - LoggingPlugin (로깅)

#### **1.2 Visual Configuration Generator**
- [ ] **UI → Robota Config**: 시각적 설정을 실제 Robota 설정으로 변환
  ```typescript
  // UI 설정에서 자동 생성되는 실제 Robota 코드
  const agent = new Robota({
    name: userConfig.name,
    aiProviders: [remoteExecutor], // Remote 시스템 활용
    defaultModel: userConfig.model,
    plugins: [
      new PlaygroundHistoryPlugin({ realTimeSync: true }),
      new ConversationHistoryPlugin({ storage: 'memory' }),
      new UsagePlugin({ trackCosts: true })
    ],
    tools: userConfig.tools
  });
  ```
- [ ] **Live Configuration Sync**: UI 변경시 실제 Robota Instance 즉시 업데이트
- [ ] **Plugin State Export**: 실행 중인 Plugin 설정 포함한 완전한 프로젝트 Export

### **2. Universal History Visualization** 📊 **[혁신적 기능]**

#### **2.1 Robota Plugin Hook System**
- [ ] **PlaygroundHistoryPlugin 구현**: Robota BasePlugin 상속
  ```typescript
  class PlaygroundHistoryPlugin extends BasePlugin {
    // Robota Lifecycle Hooks 활용
    override async beforeExecution(context: BaseExecutionContext): Promise<void>;
    override async afterToolCall(toolName: string, result: ToolExecutionResult): Promise<void>;
    override async onMessageAdded(message: Message): Promise<void>;
    override async onStreamingChunk(chunk: UniversalMessage): Promise<void>;
    override async onModuleEvent(eventType: EventType, eventData: EventData): Promise<void>;
  }
  ```
- [ ] **Event-Driven Collection**: EventEmitterPlugin으로 모든 이벤트 자동 수집
- [ ] **WebSocket Real-time Sync**: Plugin → UI 실시간 데이터 동기화

#### **2.2 Visual History Display**
- [ ] **Block-style Conversation Flow**: 대화를 블록 형태로 시각화
  - User Message 블록 (파란색)
  - AI Response 블록 (초록색)
  - Tool Call 블록 (노란색)
  - Error 블록 (빨간색)
- [ ] **Interactive Timeline**: 클릭 가능한 대화 타임라인
- [ ] **Branch Visualization**: 다중 대화 경로 시각화
- [ ] **Statistics Display**: 대화 통계 정보
  - 총 메시지 수
  - 토큰 사용량
  - 응답 시간
  - Tool 사용 횟수

### **3. Interactive Execution System** ⚡ **[새로운 실행 방식]**

#### **3.1 Visual Execution Interface**
- [ ] **Run from Visual Structure**: 시각적 구조에서 직접 실행
- [ ] **Step-by-step Execution**: 단계별 실행 및 디버깅
- [ ] **Live Agent Status**: 실행 중 Agent 상태 실시간 표시

#### **3.2 Chat Interface Integration**
- [ ] **Three-Panel Layout**: 
  - 왼쪽: Agent Structure Display (Tool 블록 포함)
  - 가운데: Chat History Visualization (Tool Call 상세 표시)
  - 오른쪽: Code Generation Panel
- [ ] **Agent/Team Mode Support**: Single Agent와 Team 모드 전환
- [ ] **Synchronized Updates**: Agent 설정 변경이 실행 및 코드에 즉시 반영
- [ ] **Context Switching**: Agent/Team 간 빠른 전환
- [ ] **Real-time Status**: Agent 실행 상태가 Structure Display에 실시간 반영

### **3. 인증 및 보안 시스템 완성** 🔐 **[중요]**

#### **3.1 사용자 인증 강화**
- [ ] **JWT 토큰**: Firebase Auth → API Server JWT 교환
- [ ] **토큰 갱신**: 만료 시 자동 갱신 메커니즘
- [ ] **세션 관리**: 사용자별 세션 추적 및 관리

#### **3.2 사용량 제한 구현**
- [ ] **Rate Limiting**: 사용자별 API 호출 제한
- [ ] **사용량 추적**: 실시간 사용량 표시 (`UsageMonitor` 컴포넌트 활성화)
- [ ] **구독 연동**: 구독 레벨별 사용량 제한 차별화

### **4. 기존 기능 통합 및 개선** ⚡ **[기존 인프라 활용]**

#### **4.1 기존 Remote System 활용**
- [ ] **Remote Execution Backend**: 기존 RemoteExecutor 시스템 활용
- [ ] **Provider Integration**: 설정된 Provider를 통한 실제 AI 호출
- [ ] **Authentication**: 기존 Firebase Auth + Playground Token 시스템 유지

#### **4.2 코드 실행 시스템 간소화**
- [ ] **템플릿 시스템 제거**: 기존 코드 에디터 및 실행 시스템 제거
- [ ] **Code Generation Only**: 설정 기반 코드 생성만 유지 (실행 없음)
- [ ] **Copy Functionality**: 생성된 코드 복사 기능으로 단순화

---

## 🚧 기타 SaaS 웹사이트 기능

### **5. 인증 시스템 (부분 완료)**
- [x] Firebase Auth 기본 구현
- [ ] **소셜 로그인**: Google, GitHub, Discord 추가
- [ ] **이메일 인증**: 이메일 확인 프로세스
- [ ] **비밀번호 재설정**: 안전한 비밀번호 재설정

### **6. 구독 및 결제 시스템** 💳 **[미구현]**
- [ ] **Stripe 통합**: 구독 결제 시스템
- [ ] **구독 플랜**: Free, Pro, Enterprise 티어
- [ ] **사용량 기반 과금**: API 호출 수 기반 요금
- [ ] **결제 관리**: 구독 변경, 취소, 환불 처리

### **7. 대시보드 및 관리** 📊 **[미구현]**
- [ ] **사용량 대시보드**: API 호출 통계, 비용 분석
- [ ] **프로젝트 관리**: 사용자별 프로젝트 저장/관리
- [ ] **API Key 관리**: 사용자별 API Key 생성/관리
- [ ] **팀 협업**: 팀 단위 프로젝트 공유

### **8. 마케팅 및 랜딩 페이지** 🎯 **[부분 완료]**
- [x] 기본 랜딩 페이지 구조
- [ ] **제품 소개**: 상세한 기능 설명
- [ ] **가격 정책**: 명확한 가격 체계 표시
- [ ] **사용 사례**: 실제 활용 예시
- [ ] **고객 후기**: 사용자 리뷰 및 추천

### **9. 문서화 및 지원** 📚 **[미구현]**
- [ ] **API 문서**: 완전한 API 문서화
- [ ] **튜토리얼**: 단계별 사용 가이드
- [ ] **FAQ**: 자주 묻는 질문
- [ ] **고객 지원**: 헬프데스크 시스템

---

## 📈 새로운 우선순위 및 일정

### **Phase 1: Visual Configuration System (1-2주)** 🎨
1. **Block-based Agent Builder UI 구현**
2. **Visual Structure Display 시스템**
3. **Code Generation Engine 개발**
4. **기존 코드 실행 시스템 제거/간소화**

### **Phase 2: Universal History Visualization (1-2주)** 📊
1. **Universal History Plugin 구현**
2. **Block-style Conversation Flow UI**
3. **Interactive Timeline 및 통계**
4. **Real-time History Collection**

### **Phase 3: Interactive Execution System (1주)** ⚡
1. **Visual Execution Interface**
2. **Three-Panel Layout 구현** (Agent Structure / Chat History / Code Generation)
3. **Chat Interface Integration** (Agent/Team 모드 지원)
4. **Live Status Display** (실시간 Agent 상태)

### **Phase 4: 기존 시스템 통합 (3-5일)** 🔧
1. **Remote System Backend 연동**
2. **Authentication 시스템 유지**
3. **Provider Integration 완성**
4. **전체 시스템 테스트**

---

## 🎯 즉시 실행 가능한 작업

### **오늘 할 수 있는 작업:**

1. **API Server 실행 테스트**:
   ```bash
   cd apps/api-server
   cp .env.example .env
   # .env 파일에 실제 API Keys 입력
   pnpm run dev
   ```

2. **Playground 연동 테스트**:
   ```bash
   cd apps/web
   # .env.local 파일에 Playground 설정 추가
   npm run dev
   ```

3. **연결 확인**:
   - `http://localhost:3001/health` 접속
   - `http://localhost:3000/playground` 에서 연결 상태 확인
   - 실제 AI Provider 응답 테스트

### **1주일 내 완성 가능:**
- ✅ Playground 실제 AI 연동
- ✅ 기본 인증 및 사용량 추적
- ✅ 안정적인 사용자 경험
- ✅ 베타 서비스 런칭 준비

현재 Remote System이 이미 75% 완료되어 있어, **Playground 실제 동작은 1-2일 내에 완성 가능**합니다! 🚀 

---

## 📋 남은 작업 체크박스 정리

### **🚀 최우선 작업: Playground 실제 동작 연결**

#### **API Server 및 연동**
- [ ] API Server 기동 (`cd apps/api-server && pnpm run dev`)
- [ ] 엔드포인트 테스트
  - [ ] `GET /health` - 서버 상태 확인
  - [ ] `GET /v1/remote/providers` - Provider 등록 상태 확인
  - [ ] `POST /v1/remote/chat` - 기본 채팅 테스트
  - [ ] `POST /v1/remote/stream` - SSE 스트리밍 테스트
- [ ] RemoteExecutor 연결 (`createPlaygroundExecutor()` 함수 검증)
- [ ] Provider 통합 (OpenAI, Anthropic, Google 모든 Provider 테스트)
- [ ] 코드 실행 (실제 AI Provider를 통한 응답 확인)
- [ ] 스트리밍 (실시간 응답 스트리밍 동작 확인)

#### **Playground 사용자 경험**
- [ ] 연결 상태 관리 강화
  - [ ] 🟢 Connected (원격 서버 연결 성공)
  - [ ] 🟡 Connecting (연결 시도 중)
  - [ ] 🔴 Disconnected (연결 실패, Mock 모드)
- [ ] 자동 재연결 (네트워크 오류 시 자동 재시도)
- [ ] Fallback 처리 (원격 실행 실패 시 Mock 응답으로 Graceful 전환)
- [ ] Import 변환 시스템 개선 (일부 케이스 실패 해결)
- [ ] Mock과 실제 RemoteExecutor 연결 완성

#### **스트리밍 응답**
- [ ] SSE 연결 (Server-Sent Events로 실시간 응답)
- [ ] 청크 처리 (스트리밍 응답 청크별 UI 업데이트)
- [ ] 타이핑 효과 (자연스러운 AI 응답 타이핑 애니메이션)

### **🔐 인증 및 보안 시스템**
- [ ] JWT 토큰 (Firebase Auth → API Server JWT 교환)
- [ ] 토큰 갱신 (만료 시 자동 갱신 메커니즘)
- [ ] 세션 관리 (사용자별 세션 추적 및 관리)
- [ ] Rate Limiting (사용자별 API 호출 제한)
- [ ] 사용량 추적 (실시간 사용량 표시, `UsageMonitor` 컴포넌트 활성화)
- [ ] 구독 연동 (구독 레벨별 사용량 제한 차별화)

### **⚡ 고급 기능**
- [ ] WebSocket 서버 (API Server에 WebSocket 지원 추가)
- [ ] 실시간 채팅 (더 빠른 응답을 위한 WebSocket 연결)
- [ ] 연결 관리 (WebSocket 연결 상태 관리 및 재연결)
- [ ] 자동 설정 (`RemoteExecutor.create(serverUrl)` 간소화)
- [ ] 환경 감지 (네트워크 상태에 따른 자동 최적화)
- [ ] 프로토콜 업그레이드 (HTTP → HTTP/2 → WebSocket 자동 전환)

### **🔧 SaaS 웹사이트 기타 기능**

#### **인증 시스템 확장**
- [ ] 소셜 로그인 (Google, GitHub, Discord 추가)
- [ ] 이메일 인증 (이메일 확인 프로세스)
- [ ] 비밀번호 재설정 (안전한 비밀번호 재설정)

#### **구독 및 결제 시스템**
- [ ] Stripe 통합 (구독 결제 시스템)
- [ ] 구독 플랜 (Free, Pro, Enterprise 티어)
- [ ] 사용량 기반 과금 (API 호출 수 기반 요금)
- [ ] 결제 관리 (구독 변경, 취소, 환불 처리)

#### **대시보드 및 관리**
- [ ] 사용량 대시보드 (API 호출 통계, 비용 분석)
- [ ] 프로젝트 관리 (사용자별 프로젝트 저장/관리)
- [ ] API Key 관리 (사용자별 API Key 생성/관리)
- [ ] 팀 협업 (팀 단위 프로젝트 공유)

#### **마케팅 및 랜딩 페이지**
- [ ] 제품 소개 (상세한 기능 설명)
- [ ] 가격 정책 (명확한 가격 체계 표시)
- [ ] 사용 사례 (실제 활용 예시)
- [ ] 고객 후기 (사용자 리뷰 및 추천)

#### **문서화 및 지원**
- [ ] API 문서 (완전한 API 문서화)
- [ ] 튜토리얼 (단계별 사용 가이드)
- [ ] FAQ (자주 묻는 질문)
- [ ] 고객 지원 (헬프데스크 시스템)

---

## 🎯 작업 우선순위

### **🔴 긴급 (1-2주) - 새로운 Playground 아키텍처**
1. **Visual Configuration System 구현**
2. **Universal History Visualization 개발**  
3. **기존 코드 실행 시스템 제거/간소화**
4. **Block-based UI 컴포넌트 개발**

### **🟡 중요 (3-5일)**
1. 인증 시스템 강화
2. 사용량 제한 및 모니터링
3. 에러 처리 및 안정성 향상
4. UI/UX 최적화

### **🟢 보통 (1-2주)**
1. 구독 및 결제 시스템
2. 사용량 추적 및 과금
3. 대시보드 및 관리 기능
4. 고객 지원 시스템

### **🔵 낮음 (추후)**
1. 랜딩 페이지 완성
2. 문서화 완료
3. 마케팅 자료 준비
4. 베타 테스트 및 피드백 