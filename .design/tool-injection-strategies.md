# Planning 시스템 도구 주입 전략

> 이 문서는 [Robota SDK Planning 시스템](./agent-planning.md)의 도구 관리 방법론을 상세히 설명합니다.

## 개요

Planning 시스템에서는 에이전트가 사용할 도구들을 **AgentFactory 레벨**과 **템플릿 레벨**, 그리고 **플래너 레벨**에서 체계적으로 관리할 수 있습니다. 이를 통해 공통 도구의 효율적 재사용과 플래너별 특화 도구의 유연한 활용을 동시에 달성합니다.

## 🛠️ 도구 주입 계층 구조

```
🎯 Planning Container (플래너별 도구 전략)
├── 역할별 도구 매핑
├── 동적 도구 선택
└── 도구 추천 시스템
     ↓
🏭 AgentFactory (공통 도구 관리)
├── 공통 도구 풀
├── 자동 주입 설정
├── 명시적 재정의 허용
└── 도구 그룹 관리
     ↓
📋 Template (템플릿별 특화 도구)
├── 전용 도구 정의
├── 공통 도구 상속 설정
└── 도구 필터링
     ↓
🤖 Agent (최종 도구 보유)
```

## 1. AgentFactory 레벨 도구 관리

### 1.1 기본 공통 도구 설정

```typescript
import { AgentFactory } from '@robota-sdk/agents';

// 모든 에이전트가 기본적으로 받는 공통 도구들
const agentFactory = new AgentFactory({
  commonTools: [
    'web_search',      // 웹 검색
    'calculator',      // 계산기
    'file_manager',    // 파일 관리
    'email_sender',    // 이메일 발송
    'text_formatter'   // 텍스트 포맷팅
  ],
  // 공통 도구 자동 주입 (기본값: true)
  autoInjectCommonTools: true,
  // 템플릿별 명시적 재정의 허용 (기본값: false)
  allowExplicitToolOverride: false
});

// 모든 에이전트가 자동으로 공통 도구를 보유
const researcher = await agentFactory.createFromTemplate('researcher');
const writer = await agentFactory.createFromTemplate('writer');
const reviewer = await agentFactory.createFromTemplate('reviewer');

// 모든 에이전트가 web_search, calculator, file_manager, email_sender, text_formatter 보유
```

### 1.2 도구 그룹 기반 관리

```typescript
// 도구를 그룹별로 분류하여 관리
const agentFactory = new AgentFactory({
  commonTools: ['basic_calculator', 'text_processor'],
  toolInjectionStrategy: {
    defaultBehavior: 'auto_inject',
    // 도구 그룹 정의
    toolGroups: {
      'research_tools': [
        'web_search',
        'academic_database',
        'citation_manager',
        'data_scraper'
      ],
      'analysis_tools': [
        'statistical_analyzer',
        'data_visualizer',
        'pattern_detector',
        'trend_analyzer'
      ],
      'writing_tools': [
        'grammar_checker',
        'style_guide',
        'document_formatter',
        'plagiarism_checker'
      ],
      'communication_tools': [
        'email_sender',
        'slack_notifier',
        'report_generator',
        'presentation_maker'
      ]
    }
  }
});

// 그룹 단위로 도구 주입
const researchAgent = await agentFactory.createFromTemplate('researcher', {
  toolGroups: ['research_tools', 'analysis_tools']
});

const writerAgent = await agentFactory.createFromTemplate('writer', {
  toolGroups: ['writing_tools', 'communication_tools']
});
```

### 1.3 고급 도구 제어 전략

```typescript
// 세밀한 도구 제어가 필요한 경우
const advancedFactory = new AgentFactory({
  commonTools: ['basic_tools'],
  toolInjectionStrategy: {
    // 기본 동작: 공통 도구 자동 주입
    defaultBehavior: 'auto_inject',
    
    // 예외 처리: 특정 템플릿들은 명시적 설정만 사용
    explicitOnly: [
      'security_agent',      // 보안 에이전트
      'sandboxed_analyzer',  // 샌드박스 분석기
      'restricted_worker'    // 제한된 작업자
    ],
    
    // 도구 접근 레벨 정의
    accessLevels: {
      'public': ['web_search', 'calculator', 'text_formatter'],
      'internal': ['database_access', 'api_caller', 'file_system'],
      'restricted': ['admin_tools', 'system_commands', 'network_tools']
    },
    
    // 에이전트별 접근 레벨 매핑
    agentAccessMapping: {
      'researcher': 'public',
      'data_analyst': 'internal',
      'system_admin': 'restricted'
    }
  }
});

// 접근 레벨에 따른 자동 도구 할당
const publicAgent = await advancedFactory.createFromTemplate('researcher');
// → public 레벨 도구들만 자동 할당

const internalAgent = await advancedFactory.createFromTemplate('data_analyst');
// → public + internal 레벨 도구들 할당

const restrictedAgent = await advancedFactory.createFromTemplate('system_admin');
// → 모든 레벨 도구들 할당
```

## 2. 템플릿 레벨 도구 관리

### 2.1 템플릿별 전용 도구 정의

```typescript
// 특정 템플릿에만 전용 도구 설정
agentFactory.registerTemplate({
  id: 'financial_analyst',
  name: 'Financial Analyst',
  description: 'Financial analysis and modeling specialist',
  config: {
    provider: 'openai',
    model: 'gpt-4o',
    systemMessage: 'You are a financial analysis expert...',
    // 이 템플릿 전용 도구들
    tools: [
      'financial_calculator',
      'stock_api',
      'economic_indicator',
      'risk_analyzer',
      'portfolio_optimizer'
    ],
    // 공통 도구도 함께 받음 (기본값: true)
    inheritCommonTools: true,
    // 도구 우선순위 설정
    toolPriority: {
      'financial_calculator': 'high',
      'stock_api': 'high',
      'web_search': 'medium',
      'calculator': 'low'  // 전용 계산기가 있으므로 우선순위 낮음
    }
  }
});

// 최종 도구: 공통 도구 + 전용 도구
const analyst = await agentFactory.createFromTemplate('financial_analyst');
// → ['web_search', 'calculator', 'file_manager', 'email_sender', 'text_formatter', 
//    'financial_calculator', 'stock_api', 'economic_indicator', 'risk_analyzer', 'portfolio_optimizer']
```

### 2.2 조건부 도구 상속

```typescript
// 공통 도구 상속을 선택적으로 제어
agentFactory.registerTemplate({
  id: 'isolated_security_agent',
  name: 'Isolated Security Agent',
  description: 'Security analysis in isolated environment',
  config: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    systemMessage: 'You are a security analysis specialist...',
    // 보안상 이유로 공통 도구 상속 비활성화
    inheritCommonTools: false,
    // 승인된 도구만 명시적으로 설정
    tools: [
      'vulnerability_scanner',
      'code_analyzer',
      'threat_detector',
      'security_calculator'  // 일반 calculator 대신 보안 버전
    ],
    // 네트워크 접근 도구 명시적 차단
    blockedTools: [
      'web_search',
      'email_sender',
      'api_caller'
    ]
  }
});
```

### 2.3 동적 도구 필터링

```typescript
// 조건에 따라 도구를 동적으로 필터링
agentFactory.registerTemplate({
  id: 'adaptive_researcher',
  name: 'Adaptive Researcher',
  description: 'Research agent with dynamic tool selection',
  config: {
    provider: 'openai',
    model: 'gpt-4o',
    systemMessage: 'You are an adaptive research specialist...',
    // 도구 필터링 함수 정의
    toolFilter: (context: AgentCreationContext) => {
      const baseLtools = ['web_search', 'academic_database', 'citation_manager'];
      
      // 연구 주제에 따른 추가 도구 선택
      if (context.researchDomain === 'scientific') {
        return [...baseLtools, 'scientific_calculator', 'formula_renderer'];
      } else if (context.researchDomain === 'business') {
        return [...baseLtools, 'market_analyzer', 'competitor_tracker'];
      } else if (context.researchDomain === 'legal') {
        return [...baseLtools, 'legal_database', 'case_law_search'];
      }
      
      return baseLtools;
    }
  }
});

// 컨텍스트에 따른 동적 도구 할당
const scientificAgent = await agentFactory.createFromTemplate('adaptive_researcher', {
  context: { researchDomain: 'scientific' }
});

const businessAgent = await agentFactory.createFromTemplate('adaptive_researcher', {
  context: { researchDomain: 'business' }
});
```

## 3. 플래너 레벨 도구 전략

### 3.1 CAMEL Planner의 역할별 도구 매핑

```typescript
import { CAMELPlanner } from '@robota-sdk/planning-camel';

// 역할별 특화 도구 전략
const camelPlanner = new CAMELPlanner(agentFactory, {
  // 역할별 도구 매핑 전략
  roleToolMapping: {
    'researcher': {
      primary: ['web_search', 'academic_database', 'citation_manager'],
      secondary: ['data_scraper', 'trend_analyzer'],
      blocked: ['file_system', 'admin_tools']  // 연구자는 시스템 도구 불필요
    },
    'writer': {
      primary: ['grammar_checker', 'style_guide', 'document_formatter'],
      secondary: ['thesaurus', 'readability_checker'],
      blocked: ['database_access', 'api_caller']  // 작성자는 외부 API 접근 불필요
    },
    'reviewer': {
      primary: ['plagiarism_checker', 'fact_checker', 'quality_analyzer'],
      secondary: ['citation_validator', 'bias_detector'],
      blocked: ['web_search']  // 검토자는 외부 검색으로 혼란 방지
    },
    'coordinator': {
      primary: ['project_tracker', 'deadline_manager', 'communication_hub'],
      secondary: ['report_generator', 'progress_analyzer'],
      blocked: []  // 조정자는 모든 도구 접근 가능
    }
  },
  
  // 공통 도구 상속 설정
  inheritCommonTools: true,
  
  // 역할간 도구 공유 정책
  crossRoleSharing: {
    'file_manager': 'all',        // 모든 역할이 파일 관리 도구 공유
    'email_sender': 'coordinator_only',  // 조정자만 이메일 발송
    'calculator': 'researcher_writer'    // 연구자와 작성자만 계산기 공유
  }
});

// 역할 기반 팀 생성시 자동 도구 할당
const result = await camelPlanner.execute("시장 조사 보고서 작성", {
  roles: ['researcher', 'writer', 'reviewer', 'coordinator']
});
```

### 3.2 ReAct Planner의 동적 도구 선택

```typescript
import { ReActPlanner } from '@robota-sdk/planning-react';

// 탐색적 문제해결을 위한 동적 도구 전략
const reactPlanner = new ReActPlanner(agentFactory, {
  // 가용 도구 풀 정의
  availableToolsPool: {
    core: ['web_search', 'calculator', 'text_processor'],
    exploration: ['data_scraper', 'api_explorer', 'pattern_detector'],
    analysis: ['statistical_analyzer', 'trend_analyzer', 'correlation_finder'],
    communication: ['email_sender', 'report_generator', 'visualization_tool']
  },
  
  // 동적 도구 선택 전략
  toolSelectionStrategy: {
    // 초기 단계: 핵심 도구만 제공
    initial: 'core',
    
    // 필요에 따라 추가 도구 요청 허용
    allowDynamicExpansion: true,
    
    // LLM이 도구 필요성을 판단하게 함
    llmToolSelection: true,
    
    // 도구 추천 시스템 활성화
    enableToolRecommendation: true
  },
  
  // 단계별 도구 진화
  toolEvolution: {
    // 성공적 도구 사용시 우선순위 증가
    adaptiveRanking: true,
    
    // 사용하지 않는 도구 자동 제거
    autoCleanup: true,
    
    // 도구 조합 패턴 학습
    patternLearning: true
  }
});

// 실행 중 도구가 동적으로 선택됨
const result = await reactPlanner.execute("복잡한 데이터 분석 및 인사이트 도출");
```

### 3.3 Reflection Planner의 품질 중심 도구 전략

```typescript
import { ReflectionPlanner } from '@robota-sdk/planning-reflection';

// 품질 개선 중심의 도구 전략
const reflectionPlanner = new ReflectionPlanner(agentFactory, {
  // 작업 단계별 도구 전략
  stageBasedTools: {
    // 초기 작업 단계
    initial_work: {
      tools: ['web_search', 'research_tools', 'basic_analyzer'],
      focus: 'productivity'  // 생산성 중심
    },
    
    // 품질 검토 단계
    quality_review: {
      tools: ['fact_checker', 'plagiarism_checker', 'bias_detector', 'logic_analyzer'],
      focus: 'accuracy'  // 정확성 중심
    },
    
    // 개선 단계
    improvement: {
      tools: ['style_improver', 'clarity_enhancer', 'completeness_checker'],
      focus: 'excellence'  // 우수성 중심
    },
    
    // 최종 검증 단계
    final_validation: {
      tools: ['comprehensive_validator', 'quality_scorer', 'benchmarking_tool'],
      focus: 'validation'  // 검증 중심
    }
  },
  
  // 품질 기준별 도구 매핑
  qualityBasedMapping: {
    accuracy: ['fact_checker', 'source_validator', 'citation_checker'],
    completeness: ['gap_analyzer', 'coverage_checker', 'requirement_validator'],
    clarity: ['readability_analyzer', 'complexity_reducer', 'flow_optimizer'],
    originality: ['plagiarism_checker', 'novelty_detector', 'creativity_scorer']
  },
  
  // 반복 개선시 도구 진화
  iterativeImprovement: {
    // 품질 점수에 따른 도구 추가
    qualityThresholdTools: {
      0.6: ['basic_improver'],
      0.7: ['basic_improver', 'style_enhancer'],
      0.8: ['basic_improver', 'style_enhancer', 'advanced_optimizer'],
      0.9: ['all_quality_tools']
    }
  }
});
```

### 3.4 Sequential Planner의 단계별 도구 최적화

```typescript
import { SequentialPlanner } from '@robota-sdk/planning-sequential';

// 단계별 최적화된 도구 전략
const sequentialPlanner = new SequentialPlanner(agentFactory, {
  // 표준 단계별 도구 정의
  stepBasedTools: {
    planning: {
      tools: ['project_planner', 'timeline_creator', 'resource_estimator'],
      agent_type: 'coordinator'
    },
    research: {
      tools: ['web_search', 'academic_database', 'data_collector'],
      agent_type: 'researcher'
    },
    analysis: {
      tools: ['data_analyzer', 'pattern_detector', 'insight_generator'],
      agent_type: 'analyst'
    },
    writing: {
      tools: ['document_creator', 'style_formatter', 'structure_optimizer'],
      agent_type: 'writer'
    },
    review: {
      tools: ['quality_checker', 'completeness_validator', 'final_reviewer'],
      agent_type: 'reviewer'
    }
  },
  
  // 단계간 도구 상속
  toolInheritance: {
    // 이전 단계 결과를 다음 단계에서 활용
    carryForward: ['file_manager', 'data_storage', 'progress_tracker'],
    
    // 특정 단계에서만 사용
    stageSpecific: true,
    
    // 단계별 최적화
    optimizePerStep: true
  },
  
  // 파이프라인 최적화
  pipelineOptimization: {
    // 병목 단계 자동 감지
    bottleneckDetection: true,
    
    // 도구 사용 패턴 분석
    usagePatternAnalysis: true,
    
    // 자동 도구 추천
    autoToolRecommendation: true
  }
});
```

## 4. 도구 충돌 및 리소스 관리

### 4.1 도구 충돌 방지

```typescript
// 도구간 충돌 방지 및 우선순위 관리
const agentFactory = new AgentFactory({
  toolConflictResolution: {
    // 동일 기능 도구 우선순위
    priorityRules: {
      'calculator': ['financial_calculator', 'scientific_calculator', 'basic_calculator'],
      'database': ['specialized_db', 'general_db', 'cache_db'],
      'search': ['domain_search', 'web_search', 'local_search']
    },
    
    // 상호 배타적 도구들
    mutuallyExclusive: [
      ['sandbox_mode', 'production_mode'],
      ['readonly_access', 'write_access'],
      ['secure_mode', 'debug_mode']
    ],
    
    // 의존성 관리
    dependencies: {
      'advanced_analyzer': ['data_loader', 'validator'],
      'report_generator': ['template_engine', 'formatter'],
      'api_caller': ['auth_manager', 'rate_limiter']
    }
  }
});
```

### 4.2 리소스 모니터링

```typescript
// 도구 사용량 모니터링 및 최적화
const agentFactory = new AgentFactory({
  resourceMonitoring: {
    // 도구별 사용량 추적
    trackUsage: true,
    
    // 성능 메트릭 수집
    performanceMetrics: ['response_time', 'success_rate', 'resource_usage'],
    
    // 자동 최적화
    autoOptimization: {
      // 사용하지 않는 도구 자동 제거
      removeUnused: true,
      
      // 자주 사용하는 도구 우선 로딩
      prioritizeFrequent: true,
      
      // 리소스 임계값 기반 제한
      resourceLimits: {
        maxToolsPerAgent: 20,
        maxMemoryUsage: '512MB',
        maxConcurrentTools: 5
      }
    }
  }
});
```

## 5. 실제 사용 예제

### 5.1 종합적인 Planning 시스템 구성

```typescript
import { AgentFactory } from '@robota-sdk/agents';
import { CAMELPlanner } from '@robota-sdk/planning-camel';
import { ReActPlanner } from '@robota-sdk/planning-react';

// 1. AgentFactory 설정 (공통 도구 + 그룹 관리)
const agentFactory = new AgentFactory({
  // Provider 불가지론적 설정
  aiProviders: {
    'primary': primaryProvider,
    'secondary': secondaryProvider
  },
  currentProvider: 'primary',
  
  // 공통 도구 설정
  commonTools: ['web_search', 'calculator', 'file_manager', 'text_processor'],
  autoInjectCommonTools: true,
  
  // 도구 그룹 정의
  toolInjectionStrategy: {
    toolGroups: {
      'research': ['academic_db', 'citation_manager', 'data_scraper'],
      'analysis': ['statistical_analyzer', 'pattern_detector', 'visualizer'],
      'writing': ['grammar_checker', 'style_guide', 'formatter'],
      'quality': ['fact_checker', 'plagiarism_checker', 'validator']
    }
  }
});

// 2. 템플릿별 전용 도구 등록
agentFactory.registerTemplate({
  id: 'senior_researcher',
  name: 'Senior Researcher',
  config: {
    // Provider 불가지론: 런타임에 결정
    systemMessage: 'You are a senior research specialist...',
    tools: ['advanced_research_tool', 'methodology_advisor'],
    toolGroups: ['research', 'analysis']
  }
});

// 3. CAMEL Planner 설정 (역할별 도구 매핑)
const camelPlanner = new CAMELPlanner(agentFactory, {
  roleToolMapping: {
    'researcher': ['research', 'analysis'],
    'writer': ['writing', 'quality'],
    'reviewer': ['quality']
  },
  inheritCommonTools: true
});

// 4. ReAct Planner 설정 (동적 도구 선택)
const reactPlanner = new ReActPlanner(agentFactory, {
  availableToolsPool: 'all',
  enableToolRecommendation: true,
  toolSelectionStrategy: {
    llmToolSelection: true,
    adaptiveRanking: true
  }
});

// 5. 실행
const researchResult = await camelPlanner.execute("AI 윤리 가이드라인 연구 보고서 작성");
const exploratoryResult = await reactPlanner.execute("새로운 기술 트렌드 탐색 및 분석");
```

## 관련 문서

- [메인 Planning 시스템 문서](./agent-planning.md)
- [AgentFactory 확장 전략](./agentfactory-expansion-strategy.md)
- [도구 분배 전략](./tool-distribution-strategies.md)
- [플래너별 템플릿 전략](./planner-template-strategies.md)
- [현재 시스템 분석](./current-system-analysis.md)
- [사용 시나리오 및 예제](./usage-scenarios-examples.md) 