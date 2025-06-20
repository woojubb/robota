# TeamWork - Multi-Agent 협업 시스템 설계

## 개요

TeamWork는 Robota SDK의 새로운 핵심 기능으로, 사용자의 복잡한 작업을 여러 전문 에이전트들이 협업하여 해결하는 시스템입니다. Team 내에서 TeamLeader가 작업을 분석하고 필요한 TeamMember들을 생성/관리하여 업무를 분산하고 결과를 취합합니다.

## 핵심 아키텍처

### 1. Team 클래스 구조

```typescript
import { Team } from '@robota-sdk/team';

const team = new Team({
  teamLeader: {
    provider: 'openai',
    model: 'gpt-4'
  },
  memberDefaults: {
    provider: 'openai',
    model: 'gpt-4',
    maxTokens: 4000
  },
  maxMembers: 5,
  sharedToolProviders: [webSearchProvider, fileSystemProvider], // 모든 에이전트가 공유할 도구들
  debug: true
});

// 사용자 프롬프트 처리 - TeamLeader가 자동으로 팀 구성
const result = await team.execute('복잡한 시장 조사를 하고 보고서를 작성해줘');
```

### 2. 단순한 delegateWork 기반 동적 협업 구조

```
Team (팀 에이전트 - 사용자 인터페이스)
├── 사용자 프롬프트 직접 접수
├── delegateWork로 "프롬프트 분석 및 업무 분배" 요청
├── 임시 TeamLeader로부터 실행 결과 수신
└── 사용자에게 최종 응답

임시 TeamLeader (작업 분석 및 관리 - 일반 에이전트)
├── 팀장 프롬프트를 받아 작업 분석 전문가로 행동
├── 사용자 프롬프트 분석 및 작업 분해
├── 각 세부 작업마다 delegateWork로 Member 생성 및 위임
├── 모든 결과 취합 및 Team에게 보고
└── 작업 완료 후 자동 정리

TeamMembers (실제 작업 수행 - 일반 에이전트들)
├── Member-001: 세부 작업 프롬프트를 받아 전문 작업 수행
├── Member-002: 세부 작업 프롬프트를 받아 전문 작업 수행
├── Member-003: 세부 작업 프롬프트를 받아 전문 작업 수행
└── ... (각각 작업 완료 후 자동 정리)
```

**핵심 개념:**
- **Team**: 에이전트이자 사용자 인터페이스, delegateWork로 분석 작업 위임
- **임시 TeamLeader**: 팀장 프롬프트를 받은 일반 에이전트, 위임받은 분석 작업 수행
- **TeamMembers**: 각각 특정 프롬프트를 받은 일반 에이전트들

**실행 플로우:**
```
사용자 → Team (에이전트) → delegateWork("프롬프트 분석 및 업무 분배") → 임시 TeamLeader
                                   ↓
                            임시 TeamLeader → delegateWork("세부 작업1 프롬프트") → Member1
                                   ↓
                            임시 TeamLeader → delegateWork("세부 작업2 프롬프트") → Member2
                                   ↓
                            임시 TeamLeader → delegateWork("세부 작업3 프롬프트") → Member3
                                   ↓
                            임시 TeamLeader → 결과 종합 → Team → 사용자
```

## 핵심 컴포넌트

### 1. Team (팀 에이전트 - Robota 인스턴스)

**본질:**
- AgentFactory에서 생성되는 **일반적인 Robota 인스턴스**
- 사용자와 직접 소통하는 팀의 대표 에이전트
- **team 역할의 시스템 프롬프트**와 **delegateWork 도구**를 가진 Robota

**역할:**
- 사용자 프롬프트 직접 접수 및 이해
- delegateWork로 "프롬프트 분석 및 업무 분배" 작업 위임
- 임시 TeamLeader로부터 완성된 결과를 받아서 사용자에게 응답
- 팀의 대외 창구 역할

**핵심 동작:**
```typescript
// Team 에이전트의 실행 예시
const result = await teamAgent.run(`
  User Request: "${userPrompt}"
  
  Use delegateWork tool to delegate the following task:
  "프롬프트를 분석해서 업무를 분배하고 member들에게 업무를 분배하세요"
  
  You are a team coordinator who delegates work to temporary team leaders.
`);
```

### 2. 임시 TeamLeader (작업 분석 에이전트 - 일반 Robota 인스턴스)

**본질:**
- AgentFactory에서 생성되는 **일반적인 Robota 인스턴스**
- **팀장 역할의 시스템 프롬프트**를 받아 작업 분석 전문가로 행동
- **delegateWork 도구**를 가진 일반 에이전트 (특별한 도구 없음)

**역할:**
- Team으로부터 "프롬프트 분석 및 업무 분배" 작업 수행
- 사용자 프롬프트를 구체적인 세부 작업들로 분해
- 각 세부 작업마다 구체적인 프롬프트 작성
- delegateWork로 각 작업을 개별 에이전트에게 위임
- 모든 결과 취합하여 완성된 응답 생성
- 작업 완료 후 자동 정리

**핵심 동작:**
```typescript
// 임시 TeamLeader의 실행 예시
const result = await temporaryTeamLeader.run(`
  Your Task: "프롬프트를 분석해서 업무를 분배하고 member들에게 업무를 분배하세요"
  
  User's Original Request: "${userPrompt}"
  
  1. Analyze the user request thoroughly
  2. Break it down into specific sub-tasks
  3. For each sub-task, use delegateWork tool with clear job description
  4. Collect all results and synthesize into a comprehensive response
  
  You are a temporary team leader with task analysis expertise.
`);
```

### 3. TeamMembers (실제 작업 수행자 - 일반 Robota 인스턴스들)

**본질:**
- AgentFactory에서 생성되는 **일반적인 Robota 인스턴스**
- 임시 TeamLeader가 작성한 구체적인 프롬프트를 받아 작업 수행
- **작업 맞춤형 시스템 프롬프트**와 **필요한 도구들**을 가진 일반 에이전트

**역할:**
- 임시 TeamLeader로부터 위임받은 구체적인 작업 프롬프트 수행
- 받은 프롬프트에 명시된 작업을 전문적으로 처리
- 작업 완료 후 결과 반환 및 자동 정리

**핵심 동작:**
```typescript
// TeamMember의 실행 예시
const result = await teamMember.run(`
  Job Assignment: "${jobDescription}"
  
  Context: ${context}
  
  Complete this specific task using your available tools and capabilities.
  Provide a clear, detailed, and professional result.
  
  You are a specialized agent created for this specific task.
`);
```

### 4. TeamContainer (실제 구현 클래스)

**본질:**
- Team 에이전트와 모든 임시 에이전트들을 관리하는 **단순한 컨테이너 클래스**
- delegateWork 도구 구현 및 동적 에이전트 생성 관리
- AgentFactory를 통한 일반 에이전트 생성

**역할:**
- Team Robota 인스턴스 보유 및 관리 (사용자 인터페이스)
- delegateWork 도구 구현 (모든 에이전트가 공유)
- 임시 에이전트들의 동적 생성 및 정리
- 프롬프트 기반 에이전트 생성 및 실행

**핵심 메서드:**
```typescript
class TeamContainer {
  private teamAgent: Robota; // Team 에이전트 (사용자 인터페이스)
  private agentFactory: AgentFactory;

  async execute(userPrompt: string): Promise<string> {
    // Team 에이전트가 사용자 프롬프트를 받아서 분석 작업 위임
    const result = await this.teamAgent.run(`
      User Request: "${userPrompt}"
      
      Use delegateWork tool to delegate the following task:
      "프롬프트를 분석해서 업무를 분배하고 member들에게 업무를 분배하세요"
      
      You are a team coordinator who delegates work to temporary team leaders.
    `);
    
    return result;
  }

  // 모든 에이전트가 공유하는 delegateWork 도구
  async delegateWork(params: {
    jobDescription: string,
    context?: string,
    requiredTools?: string[]
  }): Promise<string> {
    // 1. 작업에 맞는 임시 에이전트 생성
    const temporaryAgent = await this.agentFactory.createRobotaForTask({
      taskDescription: params.jobDescription,
      requiredTools: params.requiredTools || []
    });
    
    // 2. 생성된 에이전트에게 작업 할당 및 실행
    const result = await temporaryAgent.run(`
      Task Assignment: ${params.jobDescription}
      ${params.context ? `Context: ${params.context}` : ''}
      
      Complete this task using your available tools and capabilities.
      If this task requires further work breakdown, use delegateWork tool to delegate sub-tasks.
      Provide a clear, detailed, and professional result.
    `);
    
    // 3. 작업 완료 후 해당 에이전트 즉시 정리
    temporaryAgent.close();
    
    return result;
  }
}
```

### 3. AgentFactory (에이전트 팩토리)

**역할:**
- TeamLeader와 TeamMember Robota 인스턴스 생성
- 역할 기반 시스템 프롬프트 자동 생성
- 능력별 도구 매칭 및 구성
- 모든 Robota 인스턴스 공급

**핵심 기능:**
```typescript
class AgentFactory {
  async createRobotaForJob(jobSpec: {
    jobDescription: string;
    requiredSkills: string[];
    context?: string;
  }): Promise<Robota> {
    
    // 작업 설명을 기반으로 적절한 역할 자동 결정
    const role = this.determineRoleFromJob(jobSpec.jobDescription);
    
    // 역할별 시스템 프롬프트 생성
    const systemPrompt = this.generateJobPrompt(role, jobSpec);
    
    // 필요한 도구들 선택
    const tools = this.selectToolsForSkills(jobSpec.requiredSkills);
    
    // 일반적인 Robota 인스턴스 생성
    const robota = new Robota({
      provider: this.defaultProvider, // OpenAI, Anthropic, Google 등
      systemMessage: systemPrompt,
      tools: tools
    });
    
    return robota;
  }

  private determineRoleFromJob(jobDescription: string): string {
    // 작업 설명을 분석해서 적절한 역할 자동 결정
    const lowerJob = jobDescription.toLowerCase();
    
    if (lowerJob.includes('research') || lowerJob.includes('search') || lowerJob.includes('find')) {
      return 'Research Specialist';
    } else if (lowerJob.includes('analy') || lowerJob.includes('data') || lowerJob.includes('statistic')) {
      return 'Data Analyst';
    } else if (lowerJob.includes('write') || lowerJob.includes('report') || lowerJob.includes('document')) {
      return 'Content Writer';
    } else if (lowerJob.includes('code') || lowerJob.includes('develop') || lowerJob.includes('program')) {
      return 'Software Developer';
    } else if (lowerJob.includes('design') || lowerJob.includes('ui') || lowerJob.includes('visual')) {
      return 'Designer';
    } else {
      return 'General Specialist';
    }
  }

  private generateJobPrompt(role: string, jobSpec: {jobDescription: string, requiredSkills: string[], context?: string}): string {
    return `
You are a ${role} working as part of a collaborative team.

Your specific job: ${jobSpec.jobDescription}
${jobSpec.context ? `Additional context: ${jobSpec.context}` : ''}
Your available skills: ${jobSpec.requiredSkills.join(', ')}

Guidelines:
1. Focus on completing the specific job assigned to you
2. Use your specialized skills and tools effectively
3. Provide clear, detailed, and actionable results
4. Be thorough and professional in your work
5. If the job requirements are unclear, make reasonable assumptions and proceed

Complete your job to the best of your ability and return a comprehensive result.
    `;
  }

  private selectToolsForSkills(skills: string[]): ToolProvider[] {
    const toolMap = {
      'web_search': webSearchToolProvider,
      'data_analysis': dataAnalysisToolProvider,
      'document_creation': documentToolProvider,
      'api_integration': apiToolProvider,
      'image_processing': imageToolProvider,
      'financial_analysis': financialToolProvider
    };
    
    return skills
      .map(skill => toolMap[skill])
      .filter(Boolean);
  }
    
  }
}
```

## 역할 상수 정의

TeamWork에서 사용할 수 있는 미리 정의된 역할들입니다. AgentFactory가 job 설명을 분석할 때 이 역할들 중에서 가장 적합한 것을 선택합니다.

### 연구 및 분석 역할

```typescript
export const RESEARCH_ROLES = {
  MARKET_RESEARCHER: 'Market Researcher',
  DATA_RESEARCHER: 'Data Researcher', 
  ACADEMIC_RESEARCHER: 'Academic Researcher',
  COMPETITIVE_ANALYST: 'Competitive Analyst',
  TREND_ANALYST: 'Trend Analyst',
  USER_RESEARCHER: 'User Researcher',
  INDUSTRY_ANALYST: 'Industry Analyst'
} as const;

export const ANALYSIS_ROLES = {
  DATA_ANALYST: 'Data Analyst',
  BUSINESS_ANALYST: 'Business Analyst',
  FINANCIAL_ANALYST: 'Financial Analyst',
  STATISTICAL_ANALYST: 'Statistical Analyst',
  PERFORMANCE_ANALYST: 'Performance Analyst',
  RISK_ANALYST: 'Risk Analyst',
  SYSTEMS_ANALYST: 'Systems Analyst'
} as const;
```

### 개발 및 기술 역할

```typescript
export const DEVELOPMENT_ROLES = {
  FRONTEND_DEVELOPER: 'Frontend Developer',
  BACKEND_DEVELOPER: 'Backend Developer',
  FULLSTACK_DEVELOPER: 'Fullstack Developer',
  MOBILE_DEVELOPER: 'Mobile Developer',
  DEVOPS_ENGINEER: 'DevOps Engineer',
  SOFTWARE_ARCHITECT: 'Software Architect',
  DATABASE_ENGINEER: 'Database Engineer',
  API_DEVELOPER: 'API Developer'
} as const;

export const QA_ROLES = {
  QA_TESTER: 'QA Tester',
  AUTOMATION_TESTER: 'Automation Tester',
  PERFORMANCE_TESTER: 'Performance Tester',
  SECURITY_TESTER: 'Security Tester',
  CODE_REVIEWER: 'Code Reviewer'
} as const;
```

### 콘텐츠 및 창작 역할

```typescript
export const CONTENT_ROLES = {
  CONTENT_WRITER: 'Content Writer',
  TECHNICAL_WRITER: 'Technical Writer',
  COPYWRITER: 'Copywriter',
  EDITOR: 'Editor',
  PROOFREADER: 'Proofreader',
  TRANSLATOR: 'Translator',
  SEO_SPECIALIST: 'SEO Specialist'
} as const;

export const CREATIVE_ROLES = {
  CREATIVE_DIRECTOR: 'Creative Director',
  GRAPHIC_DESIGNER: 'Graphic Designer',
  UI_DESIGNER: 'UI Designer',
  UX_DESIGNER: 'UX Designer',
  VISUAL_DESIGNER: 'Visual Designer',
  BRAND_DESIGNER: 'Brand Designer'
} as const;
```

### 비즈니스 및 전략 역할

```typescript
export const BUSINESS_ROLES = {
  BUSINESS_STRATEGIST: 'Business Strategist',
  PRODUCT_MANAGER: 'Product Manager',
  PROJECT_MANAGER: 'Project Manager',
  MARKETING_SPECIALIST: 'Marketing Specialist',
  SALES_SPECIALIST: 'Sales Specialist',
  CONSULTANT: 'Business Consultant',
  OPERATIONS_SPECIALIST: 'Operations Specialist'
} as const;

export const FINANCE_ROLES = {
  FINANCIAL_PLANNER: 'Financial Planner',
  INVESTMENT_ADVISOR: 'Investment Advisor',
  BUDGET_ANALYST: 'Budget Analyst',
  ACCOUNTING_SPECIALIST: 'Accounting Specialist',
  TAX_SPECIALIST: 'Tax Specialist'
} as const;
```

### 커뮤니케이션 및 지원 역할

```typescript
export const COMMUNICATION_ROLES = {
  CUSTOMER_SERVICE: 'Customer Service Representative',
  SUPPORT_SPECIALIST: 'Support Specialist',
  COMMUNITY_MANAGER: 'Community Manager',
  PUBLIC_RELATIONS: 'Public Relations Specialist',
  TRAINING_SPECIALIST: 'Training Specialist'
} as const;

export const COORDINATION_ROLES = {
  PROJECT_COORDINATOR: 'Project Coordinator',
  TEAM_LEAD: 'Team Lead',
  SCRUM_MASTER: 'Scrum Master',
  FACILITATOR: 'Meeting Facilitator',
  ORGANIZER: 'Event Organizer'
} as const;
```

### 전문 기술 역할

```typescript
export const TECHNICAL_ROLES = {
  DATA_SCIENTIST: 'Data Scientist',
  ML_ENGINEER: 'Machine Learning Engineer',
  AI_SPECIALIST: 'AI Specialist',
  CYBERSECURITY_EXPERT: 'Cybersecurity Expert',
  NETWORK_ENGINEER: 'Network Engineer',
  CLOUD_ARCHITECT: 'Cloud Architect',
  BLOCKCHAIN_DEVELOPER: 'Blockchain Developer'
} as const;

export const DOMAIN_EXPERTS = {
  LEGAL_ADVISOR: 'Legal Advisor',
  HEALTHCARE_SPECIALIST: 'Healthcare Specialist',
  EDUCATION_SPECIALIST: 'Education Specialist',
  REAL_ESTATE_EXPERT: 'Real Estate Expert',
  LOGISTICS_SPECIALIST: 'Logistics Specialist',
  SUPPLY_CHAIN_EXPERT: 'Supply Chain Expert'
} as const;
```

### 범용 역할

```typescript
export const GENERAL_ROLES = {
  GENERAL_SPECIALIST: 'General Specialist',
  PROBLEM_SOLVER: 'Problem Solver',
  RESEARCHER: 'Researcher',
  ANALYST: 'Analyst',
  COORDINATOR: 'Coordinator',
  ADVISOR: 'Advisor',
  ASSISTANT: 'Assistant'
} as const;
```

### 역할 매핑 유틸리티

```typescript
// 모든 역할을 하나의 객체로 통합
export const ALL_ROLES = {
  ...RESEARCH_ROLES,
  ...ANALYSIS_ROLES,
  ...DEVELOPMENT_ROLES,
  ...QA_ROLES,
  ...CONTENT_ROLES,
  ...CREATIVE_ROLES,
  ...BUSINESS_ROLES,
  ...FINANCE_ROLES,
  ...COMMUNICATION_ROLES,
  ...COORDINATION_ROLES,
  ...TECHNICAL_ROLES,
  ...DOMAIN_EXPERTS,
  ...GENERAL_ROLES
} as const;

// Job 키워드와 역할 매핑
export const JOB_KEYWORD_TO_ROLE = {
  // Research keywords
  'research': RESEARCH_ROLES.MARKET_RESEARCHER,
  'search': RESEARCH_ROLES.DATA_RESEARCHER,
  'find': RESEARCH_ROLES.RESEARCHER,
  'investigate': RESEARCH_ROLES.ACADEMIC_RESEARCHER,
  'study': RESEARCH_ROLES.ACADEMIC_RESEARCHER,
  
  // Analysis keywords
  'analyze': ANALYSIS_ROLES.DATA_ANALYST,
  'analysis': ANALYSIS_ROLES.DATA_ANALYST,
  'data': ANALYSIS_ROLES.DATA_ANALYST,
  'statistics': ANALYSIS_ROLES.STATISTICAL_ANALYST,
  'financial': FINANCE_ROLES.FINANCIAL_PLANNER,
  'business': BUSINESS_ROLES.BUSINESS_ANALYST,
  
  // Development keywords
  'code': DEVELOPMENT_ROLES.FULLSTACK_DEVELOPER,
  'develop': DEVELOPMENT_ROLES.FULLSTACK_DEVELOPER,
  'program': DEVELOPMENT_ROLES.FULLSTACK_DEVELOPER,
  'frontend': DEVELOPMENT_ROLES.FRONTEND_DEVELOPER,
  'backend': DEVELOPMENT_ROLES.BACKEND_DEVELOPER,
  'mobile': DEVELOPMENT_ROLES.MOBILE_DEVELOPER,
  'api': DEVELOPMENT_ROLES.API_DEVELOPER,
  'database': DEVELOPMENT_ROLES.DATABASE_ENGINEER,
  
  // Testing keywords
  'test': QA_ROLES.QA_TESTER,
  'testing': QA_ROLES.QA_TESTER,
  'qa': QA_ROLES.QA_TESTER,
  'quality': QA_ROLES.QA_TESTER,
  'review': QA_ROLES.CODE_REVIEWER,
  
  // Content keywords
  'write': CONTENT_ROLES.CONTENT_WRITER,
  'writing': CONTENT_ROLES.CONTENT_WRITER,
  'content': CONTENT_ROLES.CONTENT_WRITER,
  'document': CONTENT_ROLES.TECHNICAL_WRITER,
  'report': CONTENT_ROLES.TECHNICAL_WRITER,
  'article': CONTENT_ROLES.CONTENT_WRITER,
  'blog': CONTENT_ROLES.CONTENT_WRITER,
  'copy': CONTENT_ROLES.COPYWRITER,
  'edit': CONTENT_ROLES.EDITOR,
  'translate': CONTENT_ROLES.TRANSLATOR,
  
  // Design keywords
  'design': CREATIVE_ROLES.GRAPHIC_DESIGNER,
  'ui': CREATIVE_ROLES.UI_DESIGNER,
  'ux': CREATIVE_ROLES.UX_DESIGNER,
  'visual': CREATIVE_ROLES.VISUAL_DESIGNER,
  'graphics': CREATIVE_ROLES.GRAPHIC_DESIGNER,
  'interface': CREATIVE_ROLES.UI_DESIGNER,
  
  // Business keywords
  'strategy': BUSINESS_ROLES.BUSINESS_STRATEGIST,
  'plan': BUSINESS_ROLES.BUSINESS_STRATEGIST,
  'manage': BUSINESS_ROLES.PROJECT_MANAGER,
  'product': BUSINESS_ROLES.PRODUCT_MANAGER,
  'project': BUSINESS_ROLES.PROJECT_MANAGER,
  'marketing': BUSINESS_ROLES.MARKETING_SPECIALIST,
  'sales': BUSINESS_ROLES.SALES_SPECIALIST,
  'consult': BUSINESS_ROLES.CONSULTANT,
  
  // Technical keywords
  'ai': TECHNICAL_ROLES.AI_SPECIALIST,
  'machine learning': TECHNICAL_ROLES.ML_ENGINEER,
  'ml': TECHNICAL_ROLES.ML_ENGINEER,
  'data science': TECHNICAL_ROLES.DATA_SCIENTIST,
  'security': TECHNICAL_ROLES.CYBERSECURITY_EXPERT,
  'cloud': TECHNICAL_ROLES.CLOUD_ARCHITECT,
  'network': TECHNICAL_ROLES.NETWORK_ENGINEER,
  'blockchain': TECHNICAL_ROLES.BLOCKCHAIN_DEVELOPER,
  
  // Support keywords
  'support': COMMUNICATION_ROLES.SUPPORT_SPECIALIST,
  'help': COMMUNICATION_ROLES.CUSTOMER_SERVICE,
  'customer': COMMUNICATION_ROLES.CUSTOMER_SERVICE,
  'service': COMMUNICATION_ROLES.CUSTOMER_SERVICE,
  'coordinate': COORDINATION_ROLES.PROJECT_COORDINATOR,
  'organize': COORDINATION_ROLES.ORGANIZER,
  'facilitate': COORDINATION_ROLES.FACILITATOR,
  
  // Default
  'default': GENERAL_ROLES.GENERAL_SPECIALIST
} as const;

// 역할별 타입 정의
export type ResearchRole = typeof RESEARCH_ROLES[keyof typeof RESEARCH_ROLES];
export type AnalysisRole = typeof ANALYSIS_ROLES[keyof typeof ANALYSIS_ROLES];
export type DevelopmentRole = typeof DEVELOPMENT_ROLES[keyof typeof DEVELOPMENT_ROLES];
export type QARole = typeof QA_ROLES[keyof typeof QA_ROLES];
export type ContentRole = typeof CONTENT_ROLES[keyof typeof CONTENT_ROLES];
export type CreativeRole = typeof CREATIVE_ROLES[keyof typeof CREATIVE_ROLES];
export type BusinessRole = typeof BUSINESS_ROLES[keyof typeof BUSINESS_ROLES];
export type FinanceRole = typeof FINANCE_ROLES[keyof typeof FINANCE_ROLES];
export type CommunicationRole = typeof COMMUNICATION_ROLES[keyof typeof COMMUNICATION_ROLES];
export type CoordinationRole = typeof COORDINATION_ROLES[keyof typeof COORDINATION_ROLES];
export type TechnicalRole = typeof TECHNICAL_ROLES[keyof typeof TECHNICAL_ROLES];
export type DomainExpertRole = typeof DOMAIN_EXPERTS[keyof typeof DOMAIN_EXPERTS];
export type GeneralRole = typeof GENERAL_ROLES[keyof typeof GENERAL_ROLES];

export type TeamRole = 
  | ResearchRole 
  | AnalysisRole 
  | DevelopmentRole 
  | QARole 
  | ContentRole 
  | CreativeRole 
  | BusinessRole 
  | FinanceRole 
  | CommunicationRole 
  | CoordinationRole 
  | TechnicalRole 
  | DomainExpertRole 
  | GeneralRole;
```

### 개선된 역할 결정 로직

```typescript
private determineRoleFromJob(jobDescription: string): string {
  const lowerJob = jobDescription.toLowerCase();
  
  // 키워드 매핑 기반 역할 결정
  for (const [keyword, role] of Object.entries(JOB_KEYWORD_TO_ROLE)) {
    if (lowerJob.includes(keyword)) {
      return role;
    }
  }
  
  // 복합 키워드 체크 (더 구체적인 매칭)
  if (lowerJob.includes('frontend') && lowerJob.includes('react')) {
    return DEVELOPMENT_ROLES.FRONTEND_DEVELOPER;
  }
  if (lowerJob.includes('backend') && lowerJob.includes('api')) {
    return DEVELOPMENT_ROLES.API_DEVELOPER;
  }
  if (lowerJob.includes('data') && lowerJob.includes('science')) {
    return TECHNICAL_ROLES.DATA_SCIENTIST;
  }
  if (lowerJob.includes('user') && lowerJob.includes('research')) {
    return RESEARCH_ROLES.USER_RESEARCHER;
  }
  if (lowerJob.includes('market') && lowerJob.includes('analysis')) {
    return ANALYSIS_ROLES.BUSINESS_ANALYST;
  }
  
  // 기본 역할 반환
  return GENERAL_ROLES.GENERAL_SPECIALIST;
}
```

## 패키지 구조: @robota-sdk/team

```
packages/team/
├── src/
│   ├── team.ts                    # 메인 Team 클래스 (단순한 컨테이너)
│   ├── factory/
│   │   ├── agent-factory.ts       # Robota 인스턴스 생성 팩토리
│   │   ├── role-generator.ts      # 역할 기반 프롬프트 생성
│   │   └── capability-matcher.ts  # 능력-도구 매칭
│   ├── tools/
│   │   ├── team-leader-tools.ts   # TeamLeader에게 주입되는 도구들
│   │   └── tool-selector.ts       # 역할별 도구 선택기
│   ├── prompts/
│   │   ├── role-templates.ts      # 역할별 프롬프트 템플릿
│   │   └── prompt-generator.ts    # 동적 프롬프트 생성기
│   └── types/
│       ├── team-types.ts          # 팀 관련 타입 정의
│       ├── role-types.ts          # 역할 관련 타입 정의
│       └── factory-types.ts       # 팩토리 타입 정의
├── package.json
├── tsconfig.json
└── README.md
```

## 실행 플로우 (단순화된 동기식)

### 1. Team 생성 및 초기화
```
사용자가 Team 인스턴스 생성
    ↓
AgentFactory에서 Boss(Robota) 생성 (delegateWork 도구 포함)
    ↓
AgentFactory에서 TeamLeader(Robota) 생성 (delegateWork 도구 포함)
    ↓
Team이 Boss와 TeamLeader를 내부에 보관
```

### 2. 3계층 작업 실행 플로우
```
team.execute(userPrompt) 호출
    ↓
Boss(Robota)가 사용자 프롬프트 접수
    ↓
Boss가 delegateWork로 전체 작업을 TeamLeader에게 위임
    ↓
TeamLeader가 작업 분석 및 세부 작업으로 분해
    ↓
TeamLeader가 각 세부 작업마다 delegateWork로 TeamMember에게 위임
    ↓
각 TeamMember가 전문 작업 수행 후 결과 반환
    ↓
TeamLeader가 모든 결과 통합하여 Boss에게 보고
    ↓
Boss가 최종 결과를 사용자에게 응답
```

### 3. 자동 정리 및 종료
```
각 TeamMember는 작업 완료 즉시 개별 정리
    ↓
TeamLeader는 모든 위임 작업 완료 후 대기
    ↓
Boss는 최종 응답 완료 후 대기
    ↓
Team 인스턴스는 다음 작업 준비 완료
```

## 핵심 기능

### 1. 3계층 책임 분산 구조
- **Boss**: 사용자 인터페이스, 복잡한 분석 없이 TeamLeader에게 위임
- **TeamLeader**: 작업 분석 전문가, 업무 분해 및 팀원 관리
- **TeamMembers**: 실제 작업 수행자, 각자의 전문 영역에서 고품질 결과 생성
- 각 계층이 명확한 책임을 가지고 `delegateWork`로 연결
- 미리 정의된 역할의 한계를 동적 분석으로 극복

### 2. 동일한 도구로 계층간 연결
- Boss, TeamLeader, TeamMembers 모두 `delegateWork` 도구 사용
- 각 계층에서 위임의 목적과 대상만 다름:
  - Boss → TeamLeader: 전체 작업 분석 및 실행 위임
  - TeamLeader → TeamMembers: 세부 작업 수행 위임
- 동일한 인터페이스로 일관성 있는 위임 체계

### 3. TeamLeader의 작업 분석 전문화
- TeamLeader는 작업 분석 및 업무 분배에 특화된 전문가
- Boss로부터 받은 사용자 요청을 심층 분석
- 적절한 세부 작업으로 분해하고 각각에 맞는 전문가 유형 결정
- 모든 결과를 통합하여 Boss에게 완성된 응답 제공

### 4. 즉시 정리 및 리소스 효율성
- 각 `delegateWork` 호출 완료 즉시 해당 에이전트 정리
- 팀 상태를 별도로 관리할 필요 없음 (일회성 작업)
- 최소한의 메모리 사용량으로 효율적인 리소스 관리

## 기술적 고려사항

### 1. 성능 최적화
- 에이전트 인스턴스 풀링
- 비동기 처리 최적화
- 메모리 사용량 관리

### 2. 오류 처리
- 개별 에이전트 실패시 복구 메커니즘
- 전체 팀 작업 실패시 롤백 처리
- 타임아웃 및 재시도 정책

### 3. 확장성
- 에이전트 타입 확장 가능한 아키텍처
- 커스텀 협업 패턴 정의 지원
- 외부 시스템 연동 인터페이스

### 4. 디버깅 및 로깅
- Team 실행 과정 추적 및 로깅
- 개별 Robota 인스턴스 성능 분석
- 단순화된 오류 추적 및 디버깅

## 예시 사용 사례

### 1. 시장 조사 및 보고서 작성
```typescript
const marketResearchTeam = new Team({
  teamLeader: {
    provider: 'openai',
    model: 'gpt-4'
  },
  memberDefaults: {
    provider: 'openai',
    model: 'gpt-4'
  },
  sharedToolProviders: [webSearchProvider, dataAnalysisProvider, documentProvider],
  maxMembers: 3
});

// TeamLeader(Robota)가 자동으로 "market researcher", "data analyst", "technical writer" 역할 생성
const result = await marketResearchTeam.execute(
  '스마트폰 시장의 2024년 트렌드를 조사하고 상세한 분석 보고서를 작성해줘'
);
```

### 2. 소프트웨어 개발 프로젝트
```typescript
const devTeam = new Team({
  teamLeader: {
    provider: 'openai',
    model: 'gpt-4'
  },
  memberDefaults: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022' // 코딩에 특화된 모델
  },
  sharedToolProviders: [fileSystemProvider, codeExecutionProvider, gitProvider],
  maxMembers: 4
});

// TeamLeader(Robota)가 자동으로 "system architect", "frontend developer", "backend developer", "qa tester" 역할 생성
const result = await devTeam.execute(
  'Todo 앱을 만들어줘. React 프론트엔드와 Node.js 백엔드가 필요해. 테스트 코드도 포함해줘.'
);
```

### 3. 실제 실행 시나리오 (시장 조사 예시)

```typescript
// 사용자가 복잡한 요청 입력
const userPrompt = '스마트폰 시장의 2024년 트렌드를 조사하고 상세한 분석 보고서를 작성해줘';

// 3계층 실행 시나리오 (스마트폰 시장 조사 예시):

// 1단계: Boss가 전체 작업을 TeamLeader에게 위임
await boss.run(`
  User Request: "${userPrompt}"
  
  Use delegateWork tool to delegate this entire task to the TeamLeader for analysis and execution.
`);

// 2단계: 임시 TeamLeader가 작업 분석 및 세부 작업들로 분해하여 각각 위임
await temporaryTeamLeader.run(`
  Your Task: "프롬프트를 분석해서 업무를 분배하고 member들에게 업무를 분배하세요"
  
  User's Original Request: ${userPrompt}
  
  1. Analyze this request thoroughly
  2. Break it down into specific sub-tasks
  3. For each sub-task, use delegateWork tool with clear job description
  4. Collect all results and synthesize into a comprehensive response
  
  You are a temporary team leader with task analysis expertise.
`);

// 임시 TeamLeader가 자동으로 다음과 같은 작업들을 각 전문가에게 위임:
/*
delegateWork({
  jobDescription: "스마트폰 시장의 현재 트렌드를 조사하고 관련 데이터를 수집하세요. 2024년 트렌드, 주요 업체, 시장 규모, 성장 전망에 중점을 두세요.",
  context: "시장 조사 전문가 역할로 웹 검색과 데이터 수집을 통해 포괄적인 정보를 수집",
  requiredTools: ["web_search", "data_collection"]
})

delegateWork({
  jobDescription: "수집된 시장 데이터를 분석하고 주요 트렌드와 패턴을 식별하세요. 의미 있는 인사이트와 트렌드를 추출하세요.",
  context: "데이터 분석 전문가 역할로 통계 분석과 시각화를 통해 인사이트 도출",
  requiredTools: ["data_analysis", "visualization"]
})

delegateWork({
  jobDescription: "조사와 분석 결과를 종합하여 포괄적인 시장 분석 보고서를 작성하세요. 전문적인 보고서 형식으로 구성하세요.",
  context: "기술 문서 작성 전문가 역할로 구조화된 보고서 작성",
  requiredTools: ["writing", "document_formatting"]
})
*/

// 3단계: 각 TeamMember가 전문 작업 수행 → 임시 TeamLeader가 통합 → Team이 최종 응답
```

## 주요 개선점 요약

### 아키텍처 개선점:
- **단일 계층 구조** → **3계층 책임 분산 구조**
- **미리 정의된 역할 한계** → **TeamLeader의 동적 작업 분석**  
- **복잡한 작업 분석 부담** → **Boss는 위임만, TeamLeader가 분석 전담**
- **역할 상수의 제약** → **실시간 작업 맞춤형 전문가 생성**
- **모든 책임이 한 곳 집중** → **계층별 명확한 역할 분담**

### 3계층 구조:
- **Boss**: 사용자 인터페이스 역할, **일반적인 Robota 인스턴스** (`delegateWork` 도구 포함)
- **TeamLeader**: 작업 분석 전문가, **일반적인 Robota 인스턴스** (`delegateWork` 도구 포함)
- **TeamMembers**: 실제 작업 수행자, **일회성 Robota 인스턴스** (각 작업 완료 후 정리)
- **Team**: 단순한 **컨테이너 클래스**, 3계층 위임 체계 관리
- **AgentFactory**: 작업 맞춤형 전문가 Robota 인스턴스 생성

## 다음 단계

1. **@robota-sdk/team 패키지 생성**: 기본 패키지 구조 및 설정
2. **Team 클래스 구현**: 단순한 컨테이너 클래스 개발
3. **AgentFactory 구현**: Robota 인스턴스 생성 및 역할별 프롬프트 자동 생성
4. **TeamLeader 도구 구현**: delegateWork 도구 개발
5. **Job 기반 역할 결정**: 작업 설명 분석을 통한 자동 역할 결정 시스템
6. **스킬-도구 매칭**: Job에 필요한 스킬 기반 도구 선택 시스템
7. **통합 테스트**: 실제 사용 사례로 검증
8. **성능 최적화**: 동적 생성 오버헤드 및 메모리 사용량 최적화
9. **문서화**: API 레퍼런스 및 사용 가이드 작성

이 구조를 통해 Robota SDK는 사용자가 복잡한 설정 없이도 간단한 요청으로 멀티 에이전트 협업을 자동으로 구성하고 실행할 수 있는 시스템으로 진화할 수 있습니다. 모든 구성 요소가 기존 Robota 구조를 최대한 활용하여 단순하고 직관적인 API를 제공합니다. 