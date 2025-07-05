# Robota Plugin vs Module Architecture Design

## 개요

Robota에서 기존의 plugin 개념을 확장하여 **Plugin**과 **Module**의 개념을 명확히 분리합니다. 이를 통해 더 명확한 아키텍처와 확장 가능한 시스템을 구축합니다.

## 문서 구조

### 📋 설계 문서들

1. **[현재 시스템 분석](./01-current-system-analysis.md)**
   - 기존 Plugin 시스템 특징
   - 현재 Plugin 타입들 분석
   - 기존 시스템의 한계점

2. **[개념 정의 및 분리](./02-concept-definition.md)**
   - Plugin 정의 및 특징
   - Module 정의 및 특징
   - 핵심 차이점 및 판별 기준

3. **[모듈 타입 시스템](./03-module-type-system.md)**
   - 유연한 모듈 타입 분류 기준
   - 동적 타입 시스템 설계
   - ModuleTypeRegistry 구현

4. **[아키텍처 설계](./04-architecture-design.md)**
   - BaseModule 인터페이스
   - ModuleRegistry 시스템
   - Plugin 시스템 개선

5. **[통합 아키텍처](./05-integration-architecture.md)**
   - Agent Configuration
   - Robota Agent Updates
   - API 설계

6. **[실용 가이드](./06-practical-guide.md)**
   - 모듈 타입 결정 트리
   - 개발자 가이드라인
   - 실무 적용 시나리오

7. **[구체적 분리 예시](./07-separation-examples.md)**
   - 현재 Plugin에서 Module로 승격될 후보들
   - 새로운 Module 영역들
   - Plugin으로 유지되는 항목들

8. **[마이그레이션 전략](./08-migration-strategy.md)**
   - 단계별 마이그레이션 계획
   - 기존 시스템과의 호환성
   - 위험 요소 및 대응 방안

## 핵심 설계 원칙

### ⚠️ 기본 전제 조건 (중요!)

**모든 Module과 Plugin은 선택적 확장 기능이어야 합니다:**
- ✅ Module/Plugin이 없어도 Robota가 에러 없이 정상 동작
- ✅ Module/Plugin 추가 시 새로운 능력이나 기능 획득  
- ❌ Module/Plugin이 없으면 주요 로직에 문제 발생 → **내부 클래스로 구현**

### 🎯 Module vs Plugin 한 줄 요약

- **Module**: "어떤 선택적 능력을 추가할 것인가?" (없어도 기본 동작 가능한 확장 기능)
- **Plugin**: "기본 동작을 어떻게 관찰/보강할 것인가?" (횡단 관심사)

### 🔍 핵심 판별 기준

**"이 기능 없이도 Robota가 기본 대화를 정상적으로 할 수 있는가?"**
- **Yes** → Module 또는 Plugin 후보 (선택적 확장)
- **No** → 내부 핵심 클래스 (Module/Plugin 불가)

### 🔍 현재 Robota 구현 현황

#### ✅ 이미 구현된 기능들 (내부 핵심 클래스)
- **AI Provider Classes**: OpenAI, Anthropic, Google 연동 (필수 구성요소)
- **Tool Execution Classes**: Function calling 시스템 (필수 구성요소)
- **Session Management Classes**: 다중 채팅 세션 관리 (필수 구성요소)
- **Message Processing Classes**: 메시지 변환/처리 (필수 구성요소)

#### ✅ 이미 구현된 Plugin들
- **Conversation History Plugin**: 대화 저장/관리 (선택적)
- **Usage/Performance/Logging Plugins**: 모니터링 시스템 (선택적)

#### 🆕 새로 구현이 필요한 Module들 (선택적 확장 기능)
- **RAG Module**: 문서 검색 기반 답변 (없어도 일반 대화 가능)
- **Speech Processing Module**: 음성 입출력 (없어도 텍스트 대화 가능)
- **Image Analysis Module**: 이미지 분석 (없어도 텍스트 대화 가능)
- **File Processing Module**: PDF/문서 읽기 (없어도 일반 대화 가능)
- **Database Connector Module**: 실시간 DB 연동 (없어도 기본 대화 가능)

### 🏗️ 아키텍처 계층

```
┌─────────────────────────────────────────────────────────────┐
│                    ROBOTA CORE (필수)                       │
│  AI Providers, Message Processing, Tool Execution,         │
│  Session Management, Conversation History                   │
└─────────────────────────────────────────────────────────────┘
           ↑ 이 없으면 Robota가 동작하지 않음

┌─────────────────── OPTIONAL MODULES ───────────────────────┐
│  RAG │ Speech │ Image Analysis │ File Processing │ DB      │
│      │        │               │                 │ Connector│
└─────────────────────────────────────────────────────────────┘
           ↑ 이 없어도 Robota는 정상 동작 (기본 대화 가능)

┌─────────────────── CROSS-CUTTING PLUGINS ──────────────────┐
│  Monitoring │ Logging │ Security │ Notification │ Analytics│
└─────────────────────────────────────────────────────────────┘
           ↑ 이 없어도 Robota는 정상 동작 (부가 기능)
```

## 주요 혁신사항

### ✨ 유연한 모듈 타입 시스템
- **ModuleTypeRegistry**: 런타임에 새로운 모듈 타입 등록 가능
- **계층적 분류**: Layer-Category-Type의 3차원 분류 체계
- **의존성 관리**: 자동화된 의존성 검증 및 초기화 순서 결정
- **호환성 검사**: 모듈 간 계층별 호환성 자동 검증

### 🎮 확장성과 유연성
- **타입 확장**: 새로운 도메인 모듈을 언제든 추가 가능
- **계층 호환성**: 상위 계층이 하위 계층을 자동으로 활용
- **능력 조합**: 여러 모듈의 능력을 조합한 새로운 기능 창출
- **플러그인 연동**: 모듈 변경사항을 플러그인이 감지하여 대응

## 실무 적용 예시

### 기본 Robota (Module/Plugin 없음)
```typescript
// 최소 구성 - 기본 대화만 가능
const basicAgent = new Robota({
    name: 'BasicAgent',
    aiProviders: {
        openai: new OpenAIProvider({ apiKey: 'sk-...' })
    },
    currentProvider: 'openai',
    currentModel: 'gpt-4'
});

// 이것만으로도 정상 동작
await basicAgent.run('안녕하세요!'); // ✅ 작동
```

### 선택적 Module 추가로 능력 확장
```typescript
// RAG 능력 추가 (선택적)
import { RAGModule } from '@robota-sdk/modules-rag';

const ragModule = new RAGModule({
    vectorStore: 'pinecone',
    embeddingProvider: 'openai'
});

const ragAgent = new Robota({
    name: 'RAGAgent',
    aiProviders: {
        openai: new OpenAIProvider({ apiKey: 'sk-...' })
    },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    modules: [ragModule]  // Module 추가
});

// 문서 추가
await ragModule.addDocument('doc1', '회사 정책: 연차는 최대 15일까지 사용 가능합니다.');

// 이제 문서 기반 답변 가능
await ragAgent.run('회사 연차 정책에 대해 알려주세요');
// → RAG Module이 문서를 검색하여 정확한 답변 제공
```

### Plugin과 Module 조합 사용
```typescript
// 실용적인 조합: 필수 기능(Module) + 모니터링(Plugin)
import { FileProcessingModule } from '@robota-sdk/modules-file';
import { LoggingPlugin, UsagePlugin } from '@robota-sdk/agents';

const fileModule = new FileProcessingModule({
    ocrProvider: 'tesseract',
    pdfParser: 'pdf2pic'
});

const agent = new Robota({
    name: 'DocumentAgent',
    aiProviders: {
        openai: new OpenAIProvider({ apiKey: 'sk-...' })
    },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    modules: [fileModule],              // 파일 처리 능력 추가
    plugins: [                          // 모니터링 기능 추가
        new LoggingPlugin({ strategy: 'console', level: 'info' }),
        new UsagePlugin({ strategy: 'memory', trackCosts: true })
    ]
});

// 파일 분석 요청
const fileContent = await fileModule.processPDF(pdfBuffer);
await agent.run(`다음 문서를 요약해주세요: ${fileContent}`);
```

### 복합 Module 에이전트 (최고급 설정)
```typescript
// 모든 능력을 갖춘 에이전트 (선택적으로 필요한 것만 추가)
import { 
    RAGModule, 
    FileProcessingModule, 
    SpeechModule 
} from '@robota-sdk/modules';

const modules = [
    new RAGModule({ vectorStore: 'pinecone' }),         // 문서 검색
    new FileProcessingModule({ ocr: true }),            // 파일 처리  
    new SpeechModule({ provider: 'elevenlabs' })        // 음성 입출력
];

const fullAgent = new Robota({
    name: 'FullCapabilityAgent',
    aiProviders: {
        openai: new OpenAIProvider({ apiKey: 'sk-...' })
    },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    modules: modules,
    plugins: [
        new UsagePlugin({ strategy: 'file', filePath: './usage.json' }),
        new PerformancePlugin({ strategy: 'memory' })
    ]
});

// 이제 파일, 음성, 문서 검색 모든 기능 사용 가능
// Module이 없어도 기본 텍스트 대화는 여전히 정상 작동
```

## 기대 효과

### 🎯 명확한 책임 분리
- **Module**: 핵심 기능 제공, 시스템 구조 정의
- **Plugin**: 확장 기능, 모니터링, 알림

### 📈 향상된 확장성
- **Module Level**: 새로운 AI 제공자, 도구 시스템 추가
- **Plugin Level**: 새로운 모니터링, 알림 기능 추가

### ⚡ 개선된 성능
- **Compile-time 최적화**: 필요한 모듈만 빌드에 포함
- **Runtime 효율성**: 활성화된 플러그인만 실행

### 🛠️ 더 나은 개발자 경험
- **명확한 API**: Module과 Plugin의 명확한 역할
- **Type Safety**: 강화된 타입 안전성
- **Easy Configuration**: 직관적인 설정 시스템

---

이 설계를 통해 Robota는 **명확한 역할 분리**, **무한한 확장성**, **체계적인 관리**를 달성하며, 개발자들이 더 강력하고 유연한 AI 에이전트를 구축할 수 있게 됩니다.

*이 설계 문서는 Robota의 Plugin과 Module 아키텍처 분리를 위한 기초 설계서입니다. 동적 모듈 타입 시스템을 통해 무한한 확장 가능성을 제공하며, 실제 구현시 세부사항은 조정될 수 있습니다.* 