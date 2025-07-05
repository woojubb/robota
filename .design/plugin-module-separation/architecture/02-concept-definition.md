# Plugin vs Module 개념 정의 및 분리

## Plugin 정의 (확장 기능)

**Robota 에이전트의 라이프사이클과 동작을 확장하는 선택적 기능**

### 특징
- 🔄 **Runtime 제어**: 동적 활성화/비활성화 가능
- 🔌 **선택적 확장**: 핵심 에이전트 동작에 영향 없이 추가/제거
- 📊 **Lifecycle Hooks**: 에이전트 실행 과정에 개입
- 🔧 **관찰 및 보강**: 기본 동작을 관찰하고 부가 기능 제공
- 🎯 **횡단 관심사**: 로깅, 모니터링, 알림, 검증 등

### Plugin 예시 (현재 8개 플러그인)
```typescript
// 사용량 추적 플러그인 - 에이전트 실행 통계 수집
class UsagePlugin extends BasePlugin {
    // beforeRun, afterRun 등에서 토큰 사용량 추적
    async beforeRun(input: string): Promise<void> {
        this.startTime = Date.now();
    }
    
    async afterRun(input: string, output: string): Promise<void> {
        this.recordUsage({
            duration: Date.now() - this.startTime,
            inputTokens: this.countTokens(input),
            outputTokens: this.countTokens(output)
        });
    }
}

// 성능 모니터링 플러그인 - 실행 시간, 메모리 사용량 추적
class PerformancePlugin extends BasePlugin {
    // 에이전트 실행 성능 지표 수집
    async beforeExecution(): Promise<void> {
        this.metrics.memoryBefore = process.memoryUsage();
    }
    
    async afterExecution(): Promise<void> {
        this.metrics.memoryAfter = process.memoryUsage();
        this.recordPerformance(this.metrics);
    }
}

// 대화 히스토리 플러그인 - 대화 내용 저장/관리
class ConversationHistoryPlugin extends BasePlugin {
    // 메시지 추가/삭제 시 스토리지에 자동 저장
    async afterRun(input: string, output: string): Promise<void> {
        await this.storage.saveConversation({
            input, output, timestamp: Date.now()
        });
    }
}
```

## Module 정의 (아키텍처 구성요소)

**Robota 에이전트가 동작하기 위해 필요한 핵심 아키텍처 구성요소**

### 특징
- ⚙️ **Architectural Components**: 시스템 아키텍처의 핵심 구성 블록
- 🏗️ **Essential Dependencies**: 에이전트 동작에 필수적인 의존성
- 📦 **Capability Providers**: 특정 도메인 기능을 제공
- 🔗 **Interface Implementation**: 표준 인터페이스의 구체적 구현
- 🎯 **Domain Experts**: 특정 영역의 전문 기능 제공

### Module의 진짜 의미
**Module은 "LLM이 할 수 없는 일을 선택적으로 추가하는 확장 기능"**

```typescript
// ❌ 이런 것들은 Module 불가 (LLM이 이미 잘 하는 일 + 필수 기능)
// - AI Provider: 대화 자체가 불가능해짐 (필수 구성요소)
// - Tool Execution: 함수 호출 로직이 깨짐 (필수 구성요소)  
// - Message Processing: 메시지 변환이 안됨 (필수 구성요소)

// ✅ Module로 적절한 것들 (LLM이 할 수 없는 일 + 선택적)
// RAG 검색 모듈 - LLM은 실시간 문서 검색 불가
interface RAGModule {
    addDocument(id: string, content: string): Promise<void>;
    searchRelevant(query: string): Promise<string[]>;
    generateAnswer(query: string, context: string[]): Promise<string>;
}

// 음성 처리 모듈 - LLM은 오디오 처리 불가  
interface SpeechModule {
    speechToText(audio: Buffer): Promise<string>;
    textToSpeech(text: string): Promise<Buffer>;
    detectLanguage(audio: Buffer): Promise<string>;
}

// Vector Search Modules - LLM은 벡터 연산/저장 불가
interface VectorSearchModule {
    embed(text: string): Promise<number[]>;
    search(query: string, topK: number): Promise<SearchResult[]>;
    addDocument(id: string, text: string, metadata?: any): Promise<void>;
}

// File Processing Modules - LLM은 파일 파싱 불가
interface FileProcessingModule {
    processImage(image: Buffer): Promise<string>;
    processPDF(pdf: Buffer): Promise<string>;
    processAudio(audio: Buffer): Promise<string>;
}

// Database Connector Module - LLM은 실시간 DB 접근 불가
interface DatabaseModule {
    query(sql: string): Promise<any[]>;
    insert(table: string, data: any): Promise<void>;
    update(table: string, id: string, data: any): Promise<void>;
}
```

## 핵심 차이점 정리

### Plugin vs Module 한 줄 요약

- **Plugin**: "에이전트가 실행될 때 무엇을 관찰하고 보강할 것인가?" (횡단 관심사)
- **Module**: "에이전트가 무엇을 할 수 있는가?" (핵심 능력)

### 실제 구분 기준

#### ✅ Module이 되어야 하는 것들 (LLM이 할 수 없는 선택적 확장 기능)
1. **외부 데이터 접근**: LLM이 직접 할 수 없는 실시간 데이터 처리
   - Vector Search Module: RAG 기반 문서 검색 (없어도 일반 대화 가능)
   - Database Connector Module: 실시간 DB 연동 (없어도 기본 대화 가능)
   - API Integration Module: 외부 API 호출 (없어도 기본 대화 가능)

2. **멀티미디어 처리**: LLM이 처리할 수 없는 미디어 형식
   - Speech Processing Module: 음성 입출력 처리 (없어도 텍스트 대화 가능)
   - Image Analysis Module: 이미지 분석 (없어도 텍스트 대화 가능)
   - File Processing Module: PDF/문서 읽기 (없어도 일반 대화 가능)

3. **저장소 구현체**: 다양한 저장 방식 선택
   - Vector Storage 구현체들 (Pinecone, Weaviate, ChromaDB)
   - Document Storage 구현체들 (Elasticsearch, MongoDB)
   - Cache Storage 구현체들 (Redis, Memcached)

#### ❌ Module이 될 수 없는 것들 (Robota 내부 핵심 클래스)
**이런 것들은 없으면 에러가 나거나 주요 로직이 깨지므로 내부 클래스로 유지:**
- **AI Provider**: 필수 구성요소, 없으면 대화 불가 (내부 클래스로 유지)
- **Tool Execution**: 함수 호출의 핵심 로직 (내부 클래스로 유지)
- **Message Processing**: 메시지 변환/처리 (내부 클래스로 유지)
- **Session Management**: 세션 관리 (내부 클래스로 유지)

#### Plugin으로 유지되어야 하는 것들  
1. **관찰 및 보강**: 기존 동작을 관찰하고 부가 기능 제공
   - Usage 추적, Performance 모니터링 (이미 구현됨)
   - Error 핸들링, Logging, Webhook 알림 (이미 구현됨)
   - ConversationHistory 저장 (이미 구현됨)

2. **횡단 관심사**: 여러 모듈에 걸쳐 적용되는 공통 기능
   - 보안, 제한, 캐싱, 압축 등 (일부 구현됨)

### 판단 기준 질문들 (수정된 기준)
1. "이 기능이 없어도 Robota가 에러 없이 정상 동작하나?" 
   - **Yes** → Module 또는 Plugin 후보
   - **No** → 내부 핵심 클래스 (Module/Plugin 불가)

2. "이 기능이 새로운 능력을 선택적으로 추가하나?"
   - **Yes** → **Module**
   - **No** → "기존 동작을 관찰/보강하나?" → **Plugin**

3. "이 기능이 Robota의 주요 로직에 필수적인가?"
   - **Yes** → 내부 클래스 (AI Provider, Tool Execution 등)
   - **No** → Module 또는 Plugin 검토

## 핵심 판별 기준 (수정됨)

**"이 기능 없이도 Robota가 기본 대화를 에러 없이 할 수 있나?"**
- **Yes, 가능** → Module 또는 Plugin 후보 (선택적 확장 기능)
- **No, 불가능** → 내부 핵심 클래스 (필수 구성요소)

**선택적 확장 기능의 경우:**
- **새로운 능력 추가** → Module (예: RAG, 음성처리, 이미지분석)
- **기존 동작 관찰/보강** → Plugin (예: 로깅, 모니터링, 알림)

### 예시 분석

#### ❌ 내부 핵심 클래스 예시 (Module/Plugin 불가)
**이런 것들은 제거하면 Robota가 에러나 동작 불가:**
- **AI Provider 제거** → 대화 자체가 불가능 → **내부 클래스** (필수)
- **Message Processing 제거** → 메시지 변환 오류 → **내부 클래스** (필수)
- **Tool Execution Core 제거** → 함수 호출 로직 오류 → **내부 클래스** (필수)

#### ✅ Module 예시 (선택적 확장 기능)
**이런 것들은 없어도 Robota가 정상 동작하며, 있으면 새로운 능력 추가:**
- **RAG 모듈 없음** → 일반 대화는 가능, 문서 검색만 불가 → **Module**
- **음성 처리 모듈 없음** → 텍스트 대화는 가능, 음성만 불가 → **Module**
- **이미지 분석 모듈 없음** → 텍스트 대화는 가능, 이미지 분석만 불가 → **Module**
- **DB 연동 모듈 없음** → 일반 대화는 가능, 실시간 DB 조회만 불가 → **Module**

#### ✅ Plugin 예시 (기존 동작 관찰/보강)
**이런 것들은 없어도 Robota가 정상 동작하며, 있으면 관찰/보강 기능 추가:**
- **로깅 시스템 제거** → 여전히 정상 작동 → **Plugin** (이미 구현됨)
- **성능 모니터링 제거** → 기능에 영향 없음 → **Plugin** (이미 구현됨)
- **대화 히스토리 저장 제거** → 기본 대화는 가능 → **Plugin** (이미 구현됨)
- **웹훅 알림 제거** → 에이전트 기능에 영향 없음 → **Plugin** (이미 구현됨)

## 비유를 통한 이해

### 자동차 비유
- **Module**: 엔진, 변속기, 브레이크 (이것 없으면 자동차가 못함)
- **Plugin**: 대시캠, 내비게이션, 오디오 (이것 없어도 자동차는 달림)

### 스마트폰 비유
- **Module**: CPU, 저장소, 네트워크 칩 (이것 없으면 스마트폰이 못함)
- **Plugin**: 카메라 필터, 배경화면, 알림음 (이것 없어도 스마트폰은 작동)

### 개발자 IDE 비유
- **Module**: 컴파일러, 디버거, 파일 시스템 (이것 없으면 개발 못함)
- **Plugin**: 테마, 코드 포맷터, 깃 통합 (이것 없어도 코딩은 가능)

## 설계 철학

### Module 철학: "LLM이 할 수 없는 일의 선택적 확장"
LLM이 직접 할 수 없는 작업을 **선택적으로 추가**하는 확장 기능입니다. Module이 없어도 Robota는 기본 대화 기능으로 정상 동작해야 하며, Module을 추가하면 LLM이 할 수 없었던 새로운 능력이 생기는 구조입니다.

**핵심 원칙**: 
- ✅ Module 없이도 Robota가 정상 동작 (기본 텍스트 대화)
- ✅ Module 추가 시 LLM이 할 수 없는 새로운 능력 획득
- ❌ Module이 없으면 에러나 주요 로직 문제 발생

**예시**: 
- RAG 모듈 → LLM은 실시간 문서 검색 불가, 추가하면 문서 검색 기반 답변
- 이미지 분석 모듈 → LLM은 이미지 직접 처리 불가, 추가하면 이미지 분석 가능
- 음성 처리 모듈 → LLM은 오디오 처리 불가, 추가하면 음성 입출력 가능
- DB 연동 모듈 → LLM은 실시간 DB 접근 불가, 추가하면 실시간 데이터 조회

### Plugin 철학: "기존 동작을 관찰하고 보강"
에이전트의 **동작(Behavior)**을 관찰하고 보강합니다. LLM의 기본 기능에는 영향을 주지 않으면서 부가 가치를 제공합니다.

**예시**:
- 대화 저장 → LLM의 대화 능력은 그대로, 단지 기록만 보관
- 성능 모니터링 → LLM 동작에 영향 없이 성능만 측정
- 사용량 추적 → 에이전트 기능과 무관하게 통계만 수집

## 개발 시 고려사항

### Module 개발 시
1. **필수성 검증**: 정말로 에이전트의 핵심 능력인가?
2. **의존성 설계**: 다른 모듈과의 의존 관계는?
3. **인터페이스 정의**: 표준화된 인터페이스를 제공하는가?
4. **능력 명세**: 제공하는 capabilities가 명확한가?

### Plugin 개발 시
1. **관찰점 식별**: 어떤 lifecycle hook을 사용할 것인가?
2. **성능 고려**: 관찰 기능이므로 오버헤드 최소화
3. **옵션 설계**: 활성화/비활성화 및 설정 가능성
4. **독립성 보장**: 다른 플러그인과 독립적으로 동작하는가?

이러한 명확한 구분을 통해 개발자는 새로운 기능을 개발할 때 적절한 확장 방식을 선택할 수 있고, 시스템의 일관성과 확장성을 유지할 수 있습니다. 