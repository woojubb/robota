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

### 🎯 Module vs Plugin 한 줄 요약

- **Module**: "에이전트가 무엇을 할 수 있는가?" (핵심 능력 제공자)
- **Plugin**: "에이전트 실행을 어떻게 관찰/보강할 것인가?" (횡단 관심사)

### 🔍 핵심 판별 기준

**"이 기능이 없으면 에이전트가 할 수 있는 일이 줄어드는가?"**
- **Yes** → Module (에이전트의 핵심 능력)
- **No** → Plugin (부가적인 관찰/개선 기능)

### 🏗️ 아키텍처 계층

```
┌─────────────────────────────────────────────────────────────┐
│                        DOMAIN LAYER                         │
│  Reasoning, Planning, Learning, Multi-modal Integration     │
├─────────────────────────────────────────────────────────────┤
│                     APPLICATION LAYER                       │
│     Memory, Tool Execution, Conversation Management         │
├─────────────────────────────────────────────────────────────┤
│                       PLATFORM LAYER                        │
│        AI Providers, Message Processing, API Gateway        │
├─────────────────────────────────────────────────────────────┤
│                    INFRASTRUCTURE LAYER                     │
│      Database, Network, File System, Basic Storage          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────── CROSS-CUTTING PLUGINS ──────────────────┐
│  Monitoring │ Logging │ Security │ Notification │ Storage │
└─────────────────────────────────────────────────────────────┘
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

### 새로운 AI 능력 추가
```typescript
// 1. 새로운 모듈 타입 등록
ModuleTypeRegistry.registerType('multimodal-reasoning', {
    type: 'multimodal-reasoning',
    category: ModuleCategory.CAPABILITY,
    layer: ModuleLayer.DOMAIN,
    dependencies: ['vision-perception', 'text-reasoning', 'memory'],
    capabilities: ['cross-modal-inference', 'visual-reasoning']
});

// 2. 에이전트에 통합
const agent = new Robota({
    modules: [
        new VisionPerceptionModule(),
        new TextReasoningModule(), 
        new MemoryModule(),
        new MultimodalReasoningModule() // 자동으로 의존성 순서 해결
    ]
});
```

### 도메인별 특화 에이전트
```typescript
// 금융 분석 에이전트
const financialAgent = new Robota({
    modules: [
        new OpenAIProviderModule(),           // PLATFORM
        new DatabaseStorageModule(),          // INFRASTRUCTURE  
        new FinancialMemoryModule(),         // APPLICATION
        new MarketAnalysisModule(),          // DOMAIN
        new RiskAssessmentModule()           // DOMAIN
    ],
    plugins: [
        new CompliancePlugin(),              // SECURITY
        new AuditLoggingPlugin(),           // LOGGING
        new AlertNotificationPlugin()        // NOTIFICATION
    ]
});
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