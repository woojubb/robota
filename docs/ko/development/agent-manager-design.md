---
title: AgentManager 설계 문서
description: Robota 에이전트 인스턴스 관리를 위한 AgentManager 설계 및 구현 계획
lang: ko-KR
date: 2024-12-XX
---

# AgentManager 설계 문서

이 문서는 Robota 프로젝트의 AgentManager 개발을 위한 전체적인 설계와 구현 계획을 다룹니다.

## 🎯 목표 및 요구사항

### 핵심 요구사항
1. **멀티 인스턴스 관리**: 서버 환경에서 사용자별로 다른 Agent 인스턴스 생성
2. **세션 관리**: 개인 사용자도 새 채팅을 열고 기존 채팅 간 전환 가능
3. **복제 기능**: `robota.clone()` 메서드로 현재 히스토리를 담은 복제본 생성
4. **팩토리 패턴**: Agent 생성, 초기화, 소멸 관리
5. **선택적 사용**: Robota 단독 사용 시 필수가 아님
6. **런타임 설정 변경**: 사용자별로 다른 AI 모델, 도구, 시스템 프롬프트 설정

## 📦 패키지 구조 및 배포

### 패키지 네이밍
**제안 1: `@robota-sdk/sessions` (권장)**
- 이유: 세션 관리가 핵심 기능이며 직관적
- 설명: "Multi-session management for Robota SDK - Agent session lifecycle, user management, and conversation history"

**제안 2: `@robota-sdk/manager`**
- 이유: AgentManager가 메인 클래스
- 설명: "Agent instance management for Robota SDK - Multi-user sessions, configuration management, and session lifecycle"

**제안 3: `@robota-sdk/multi-session`**
- 이유: 멀티 세션이 핵심 차별점
- 설명: "Multi-session agent management for Robota SDK"

### 패키지 디렉토리 구조
```
packages/sessions/                    # @robota-sdk/sessions
├── src/
│   ├── index.ts                     # 메인 export
│   ├── agent-manager.ts             # AgentManager 클래스
│   ├── agent-instance.ts            # AgentInstance 클래스  
│   ├── session-manager.ts           # SessionManager 클래스
│   ├── enhanced-history/            # Enhanced ConversationHistory (추후 core로 이동)
│   │   ├── index.ts
│   │   ├── enhanced-conversation-history.ts
│   │   ├── configuration-change.ts
│   │   └── types.ts
│   ├── types/                       # 타입 정의
│   │   ├── index.ts
│   │   ├── agent-manager.ts
│   │   ├── agent-instance.ts
│   │   └── session.ts
│   └── utils/                       # 유틸리티
│       ├── index.ts
│       ├── options-merger.ts
│       └── session-utils.ts
├── __tests__/                       # 테스트
│   ├── agent-manager.test.ts
│   ├── agent-instance.test.ts
│   ├── session-manager.test.ts
│   └── enhanced-history.test.ts
├── examples/                        # 예제 코드
│   ├── basic-usage.ts
│   ├── multi-user-server.ts
│   ├── session-cloning.ts
│   └── runtime-configuration.ts
├── docs/                           # 패키지별 문서
│   ├── README.md
│   ├── api-reference.md
│   └── migration-guide.md
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── CHANGELOG.md
```

### package.json 구조
```json
{
  "name": "@robota-sdk/sessions",
  "version": "0.1.0",
  "description": "Multi-session management for Robota SDK - Agent session lifecycle, user management, and conversation history with runtime configuration changes",
  "type": "module",
  "main": "dist/index.js",
  "module": "dist/index.mjs", 
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    }
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/woojubb/robota.git",
    "directory": "packages/sessions"
  },
  "homepage": "https://robota.io/",
  "bugs": {
    "url": "https://github.com/woojubb/robota/issues"
  },
  "files": [
    "dist",
    "README.md",
    "CHANGELOG.md"
  ],
  "scripts": {
    "build": "tsup",
    "build:check": "pnpm run typecheck && pnpm run build",
    "dev": "tsup --watch",
    "clean": "rimraf dist && rimraf tsconfig.tsbuildinfo",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src --ext .ts,.tsx",
    "lint:fix": "eslint src --ext .ts,.tsx --fix",
    "prepublishOnly": "pnpm run clean && pnpm run build:check && pnpm run test"
  },
  "keywords": [
    "ai",
    "agent",
    "llm",
    "session-management",
    "multi-session",
    "multi-user",
    "session-lifecycle",
    "agent-manager",
    "conversation-history",
    "configuration-management",
    "runtime-configuration",
    "session-cloning",
    "session-forking",
    "typescript",
    "robota",
    "sdk",
    "openai",
    "anthropic",
    "google-ai",
    "ai-integration"
  ],
  "author": "Robota SDK Team",
  "license": "MIT",
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "@robota-sdk/core": "workspace:*",
    "uuid": "^9.0.1"
  },
  "peerDependencies": {
    "@robota-sdk/core": "^0.3.3"
  },
  "devDependencies": {
    "@types/uuid": "^9.0.7",
    "rimraf": "^5.0.5",
    "tsup": "^8.0.1",
    "typescript": "^5.3.3",
    "vitest": "^1.6.1",
    "eslint": "^8.56.0"
  },
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  }
}
```

## 🏗️ 아키텍처 개요

```
@robota-sdk/sessions
├── AgentManager (Factory)
│   ├── AgentInstance (Robota + Session Metadata)
│   │   ├── sessionId: string
│   │   ├── userId?: string
│   │   ├── robota: Robota (Enhanced ConversationHistory 포함)
│   │   ├── parentSessionId?: string
│   │   └── metadata: SessionMetadata
│   ├── SessionManager
│   │   ├── 세션 생성/삭제/조회
│   │   ├── 세션 간 전환
│   │   └── 세션 메타데이터 관리
│   └── (추후) Enhanced ConversationHistory → @robota-sdk/core로 이동
└── 의존성: @robota-sdk/core
```

## 📋 핵심 인터페이스 설계

### AgentManagerOptions
```typescript
interface AgentManagerOptions {
  // 글로벌 기본 설정 (모든 에이전트의 fallback)
  defaultRobotaOptions?: RobotaOptions;
  
  // 매니저 설정
  maxInstancesPerUser?: number;
  sessionTimeout?: number;
  historyRetentionDays?: number;
}
```

### CreateAgentOptions
```typescript
interface CreateAgentOptions {
  // 이 에이전트의 특화 설정 (런타임 주입)
  robotaOptions?: RobotaOptions;
  
  // 사용자별 기본 설정 (이 사용자의 모든 새 세션에 적용)
  userDefaults?: Partial<RobotaOptions>;
  
  // 세션 메타데이터
  sessionName?: string;
  description?: string;
  tags?: string[];
  
  // 복제/포크 관련
  parentSessionId?: string;
  inheritParentConfig?: boolean;
  initialSummary?: string; // 포크 시 요약 내용
}
```

### AgentInstance
```typescript
interface AgentInstance {
  // 기본 정보
  readonly sessionId: string;
  readonly userId?: string;
  readonly robota: Robota; // Enhanced ConversationHistory를 가진 Robota
  
  // 현재 설정 정보
  currentOptions: RobotaOptions;
  userDefaults?: Partial<RobotaOptions>;
  
  // 세션 메타데이터
  sessionName?: string;
  description?: string;
  tags?: string[];
  parentSessionId?: string;
  readonly createdAt: Date;
  lastUsedAt: Date;
  
  // === Robota 위임 메서드들 ===
  execute(prompt: string, options?: RunOptions): Promise<string>;
  executeStream(prompt: string, options?: RunOptions): Promise<AsyncIterable<StreamingResponseChunk>>;
  
  // === 런타임 설정 변경 (Robota의 Enhanced History에 기록됨) ===
  updateModel(providerName: string, model: string): void;
  addToolProvider(toolProvider: ToolProvider): void;
  updateSystemPrompt(prompt: string): void;
  updateTemperature(temperature: number): void;
  updateUserDefaults(defaults: Partial<RobotaOptions>): void;
  
  // === 복제/Fork 기능 ===
  clone(options?: CloneOptions): AgentInstance;
  fork(options?: ForkOptions): Promise<AgentInstance>;
  
  // === 히스토리 및 설정 조회 (Robota에 위임) ===
  getChatHistory(): UniversalMessage[]; // robota.getChatHistory()
  getConfigurationHistory(): ConfigurationChange[]; // robota.getConfigurationHistory()
  getConfiguration(): RobotaOptions;
  getConfigurationDiff(): Partial<RobotaOptions>; // 기본값과의 차이점
}
```

## 🔧 Enhanced ConversationHistory (Robota Core 확장)

> **주요 변경**: Operation History는 별도 인터페이스가 아닌 기존 `ConversationHistory`의 확장으로 구현

### Enhanced ConversationHistory Interface
```typescript
interface ConfigurationChange {
  id: string;
  type: ConfigurationType;
  timestamp: Date;
  oldValue?: any;
  newValue: any;
  metadata?: Record<string, any>;
}

enum ConfigurationType {
  MODEL_CHANGED = 'model_changed',
  TOOL_ADDED = 'tool_added',
  TOOL_REMOVED = 'tool_removed',
  SYSTEM_PROMPT_CHANGED = 'system_prompt_changed',
  TEMPERATURE_CHANGED = 'temperature_changed',
  MAX_TOKENS_CHANGED = 'max_tokens_changed',
  SESSION_CREATED = 'session_created',
  SESSION_CLONED = 'session_cloned',
  SESSION_FORKED = 'session_forked'
}

// 기존 ConversationHistory 확장
interface EnhancedConversationHistory extends ConversationHistory {
  // 설정 변경 기록
  addConfigurationChange(change: Omit<ConfigurationChange, 'id' | 'timestamp'>): void;
  getConfigurationChanges(type?: ConfigurationType): ConfigurationChange[];
  clearConfigurationHistory(): void;
  
  // 구분된 히스토리 조회
  getChatMessages(): UniversalMessage[]; // 채팅 메시지만
  getAllHistory(): (UniversalMessage | ConfigurationChange)[]; // 모든 기록 시간순
  
  // 복제/포크 지원
  clone(): EnhancedConversationHistory;
  exportHistory(): {
    chatMessages: UniversalMessage[];
    configurationChanges: ConfigurationChange[];
  };
  importHistory(data: {
    chatMessages: UniversalMessage[];
    configurationChanges: ConfigurationChange[];
  }): void;
}
```

### Enhanced Robota 클래스 (기존 확장)
```typescript
// packages/core/src/robota.ts 확장
class Robota {
  private conversationHistory: EnhancedConversationHistory; // 기존을 Enhanced로 변경
  
  // 기존 메서드들...
  
  // === 새로운 설정 변경 메서드들 ===
  updateModel(providerName: string, model: string): void {
    const oldProvider = this.currentProvider;
    const oldModel = this.currentModel;
    
    // 실제 설정 변경
    this.currentProvider = providerName;
    this.currentModel = model;
    
    // 히스토리에 기록
    this.conversationHistory.addConfigurationChange({
      type: ConfigurationType.MODEL_CHANGED,
      oldValue: { provider: oldProvider, model: oldModel },
      newValue: { provider: providerName, model: model }
    });
  }
  
  updateSystemPrompt(prompt: string): void {
    const oldPrompt = this.systemPrompt;
    this.systemPrompt = prompt;
    
    this.conversationHistory.addConfigurationChange({
      type: ConfigurationType.SYSTEM_PROMPT_CHANGED,
      oldValue: oldPrompt,
      newValue: prompt
    });
  }
  
  // === 새로운 히스토리 조회 메서드들 ===
  getChatHistory(): UniversalMessage[] {
    return this.conversationHistory.getChatMessages();
  }
  
  getConfigurationHistory(): ConfigurationChange[] {
    return this.conversationHistory.getConfigurationChanges();
  }
  
  // === 복제 기능 ===
  clone(): Robota {
    const clonedHistory = this.conversationHistory.clone();
    
    const clonedRobota = new Robota({
      ...this.getOptions(),
      conversationHistory: clonedHistory
    });
    
    // 복제 기록
    clonedHistory.addConfigurationChange({
      type: ConfigurationType.SESSION_CLONED,
      newValue: { originalSessionId: this.sessionId, clonedAt: new Date() }
    });
    
    return clonedRobota;
  }
}
```

## 🔧 AgentManager 클래스 설계

### 메인 클래스 (간소화됨)
```typescript
class AgentManager {
  private defaultOptions: RobotaOptions;
  private instances: Map<string, AgentInstance>;
  private userSessions: Map<string, Set<string>>;
  private sessionManager: SessionManager;

  constructor(options?: AgentManagerOptions);

  // === 에이전트 생성 및 관리 ===
  createAgent(userId?: string, options?: CreateAgentOptions): AgentInstance;
  getAgent(sessionId: string): AgentInstance | undefined;
  destroyAgent(sessionId: string): void;
  
  // === 사용자별 관리 ===
  getUserAgents(userId: string): AgentInstance[];
  destroyUserAgents(userId: string): void;
  
  // === 글로벌 설정 관리 ===
  updateDefaultOptions(options: Partial<RobotaOptions>): void;
  getDefaultOptions(): RobotaOptions;
  
  // === 통계 및 모니터링 ===
  getActiveSessionCount(): number;
  getUserSessionCount(userId: string): number;
  getGlobalStatistics(): AgentManagerStatistics;
  
  // === 정리 및 유지보수 ===
  cleanupExpiredSessions(): void;
}
```

## 💡 사용 예시

### 패키지 설치 및 기본 사용
```bash
npm install @robota-sdk/sessions @robota-sdk/core @robota-sdk/openai
```

```typescript
import { AgentManager } from '@robota-sdk/sessions';
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

// 1. AgentManager 초기화 (기본 설정만)
const agentManager = new AgentManager({
  defaultRobotaOptions: {
    aiProviders: { openai: new OpenAIProvider({ client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }) }) },
    currentProvider: 'openai',
    currentModel: 'gpt-4'
  }
});

// 2. 사용자별 에이전트 생성 (런타임 설정 주입)
const userAgent = agentManager.createAgent('user123', {
  robotaOptions: {
    currentModel: 'gpt-4-turbo',
    temperature: 0.8,
    systemPrompt: 'You are a helpful coding assistant.'
  },
  userDefaults: {
    temperature: 0.7, // 이 사용자의 기본 temperature
    maxTokens: 4000
  },
  sessionName: 'Coding Session'
});

// 3. 채팅 실행 (Enhanced ConversationHistory에 자동 기록)
const response = await userAgent.execute('Hello, help me with Python code.');

// 4. 런타임 설정 변경 (Enhanced ConversationHistory에 기록됨)
userAgent.updateModel('anthropic', 'claude-3-opus');
userAgent.addToolProvider(pythonToolProvider);

// 5. 현재 세션 복제
const clonedAgent = userAgent.clone({
  sessionName: 'Cloned Coding Session',
  inheritConfig: true
});

// 6. 새 세션으로 Fork (요약과 함께)
const forkedAgent = await userAgent.fork({
  summaryPrompt: 'Summarize our Python discussion and continue focusing on best practices.',
  sessionName: 'Python Best Practices Session'
});
```

### 서버 환경에서의 멀티 유저 사용
```typescript
// Express 서버 예제
import express from 'express';
import { AgentManager } from '@robota-sdk/sessions';

const app = express();
const agentManager = new AgentManager({
  maxInstancesPerUser: 5,
  sessionTimeout: 30 * 60 * 1000 // 30분
});

app.post('/api/sessions', async (req, res) => {
  const { userId, sessionName } = req.body;
  
  const agent = agentManager.createAgent(userId, {
    sessionName,
    robotaOptions: {
      currentModel: 'gpt-4',
      temperature: 0.7
    }
  });
  
  res.json({ sessionId: agent.sessionId });
});

app.post('/api/sessions/:sessionId/chat', async (req, res) => {
  const { sessionId } = req.params;
  const { message } = req.body;
  
  const agent = agentManager.getAgent(sessionId);
  if (!agent) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const response = await agent.execute(message);
  res.json({ response });
});
```

### 히스토리 조회 및 분석
```typescript
// 채팅 히스토리만 조회 (Robota에 위임)
const chatHistory = userAgent.getChatHistory();

// 설정 변경 기록 조회 (Robota에 위임)
const configHistory = userAgent.getConfigurationHistory();

// 특정 타입의 설정 변경만 조회
const modelChanges = userAgent.robota.getConfigurationHistory()
  .filter(change => change.type === ConfigurationType.MODEL_CHANGED);
```

## 📅 구현 단계별 계획

### Phase 1: Enhanced ConversationHistory 구현 (우선순위: 🔥)
- [ ] 기존 `ConversationHistory` 인터페이스 확장
- [ ] `ConfigurationChange` 인터페이스 및 `ConfigurationType` 정의
- [ ] `EnhancedConversationHistory` 구현체 개발
- [ ] 기존 Robota 클래스에 Enhanced History 통합

**예상 소요시간**: 1.5주

### Phase 2: Robota Core 확장 (우선순위: 🔥)
- [ ] Robota 클래스에 설정 변경 메서드 추가
- [ ] 히스토리 조회 메서드 추가 (`getChatHistory`, `getConfigurationHistory`)
- [ ] 복제 기능 구현 (`clone()` 메서드)
- [ ] 설정 병합 로직 (`mergeOptions` 메서드)

**예상 소요시간**: 2주

### Phase 3: 패키지 구조 및 기본 AgentManager (우선순위: ⚡)
- [ ] `@robota-sdk/sessions` 패키지 구조 생성
- [ ] 기본 `package.json`, `tsconfig.json`, `tsup.config.ts` 설정
- [ ] `AgentManager` 클래스 기본 구현
- [ ] `AgentInstance` 기본 구조 및 Robota 위임 메서드
- [ ] 세션 생성/조회/삭제 기본 기능

**예상 소요시간**: 1.5주

### Phase 4: 세션 관리 및 메타데이터 (우선순위: ⚡)
- [ ] `SessionManager` 구현
- [ ] 세션 메타데이터 관리 (이름, 태그, 설명 등)
- [ ] 세션 생명주기 관리 및 정리 기능
- [ ] 사용자별 세션 조회 및 관리
- [ ] 사용자별 세션 그룹핑

**예상 소요시간**: 1주

### Phase 5: 복제 및 Fork 기능 (우선순위: ⚡)
- [ ] AgentInstance `clone()` 메서드 구현
- [ ] `fork()` 메서드 구현 (요약 기능 포함)
- [ ] 부모-자식 세션 관계 추적
- [ ] 설정 상속 및 오버라이드 로직

**예상 소요시간**: 2주

### Phase 6: 예제 및 문서화 (우선순위: ⚡)
- [ ] 기본 사용법 예제 (`examples/basic-usage.ts`)
- [ ] 멀티 유저 서버 예제 (`examples/multi-user-server.ts`)
- [ ] 세션 복제/포크 예제 (`examples/session-cloning.ts`)
- [ ] 런타임 설정 변경 예제 (`examples/runtime-configuration.ts`)
- [ ] 패키지 README.md 작성
- [ ] API 참조 문서 작성
- [ ] 마이그레이션 가이드 작성

**예상 소요시간**: 1주

### Phase 7: 테스트 및 배포 준비 (우선순위: ⚡)
- [ ] 유닛 테스트 작성 (vitest)
- [ ] 통합 테스트 작성
- [ ] 타입 검사 및 빌드 설정
- [ ] CI/CD 설정 (.github/workflows)
- [ ] changeset 설정 및 배포 준비
- [ ] npm 패키지 배포

**예상 소요시간**: 1.5주

### Phase 8: 고급 기능 및 최적화 (우선순위: 💡)
- [ ] 히스토리 필터링 및 검색 기능
- [ ] 세션 통계 및 모니터링
- [ ] 메모리 최적화 및 가비지 컬렉션
- [ ] 히스토리 내보내기/가져오기 기능
- [ ] 성능 벤치마킹

**예상 소요시간**: 1.5주

**총 예상 소요시간**: 10주

## 🔍 배포 및 패키지 관련 고려사항

### 의존성 관리
1. **Core 의존성**: `@robota-sdk/core`는 peerDependency로 설정
2. **패키지 버전**: 기존 SDK와 동일한 semantic versioning
3. **Workspace 관리**: pnpm workspace를 활용한 로컬 개발
4. **Changeset 통합**: 기존 changeset 설정에 새 패키지 추가

### 배포 파이프라인
1. **CI/CD**: 기존 GitHub Actions 워크플로우 확장
2. **빌드 설정**: tsup을 활용한 ESM/CJS 동시 지원
3. **타입 정의**: TypeScript 선언 파일 자동 생성
4. **문서 생성**: typedoc 자동 생성 설정

### 하위 호환성
1. **점진적 도입**: 기존 Robota 사용법에 영향 없음
2. **선택적 사용**: AgentManager 없이도 Robota 단독 사용 가능
3. **Enhanced History**: 기존 ConversationHistory와 호환성 유지

### 모니터링 및 유지보수
1. **패키지 크기**: Bundle size 모니터링
2. **성능 테스트**: 메모리 사용량 및 응답 시간 측정
3. **사용 분석**: npm 다운로드 및 사용 패턴 분석
4. **이슈 추적**: GitHub Issues 템플릿 및 라벨링

## 🔍 고려사항 및 이슈

### 기술적 고려사항
1. **메모리 관리**: Enhanced ConversationHistory가 계속 쌓이므로 적절한 정리 전략 필요
2. **동시성**: 멀티 사용자 환경에서의 Thread Safety 보장
3. **성능**: 대용량 히스토리 조회 시 성능 최적화
4. **호환성**: 기존 Robota API와의 완벽한 호환성 유지
5. **하위 호환성**: 기존 `ConversationHistory` 사용 코드 호환성 보장
6. **패키지 크기**: 번들 크기 최적화 및 Tree-shaking 지원

### 설계 결정사항
1. **히스토리 저장소**: 초기에는 메모리, 향후 외부 저장소 옵션 추가
2. **설정 병합**: 런타임 주입 방식으로 유연성 확보
3. **Enhanced History**: 기존 ConversationHistory를 확장하여 설정 변경도 추적
4. **세션 ID**: UUID v4 사용하여 충돌 방지
5. **분리된 관심사**: AgentManager는 세션 관리만, 히스토리는 Robota Core가 담당
6. **패키지 분리**: `@robota-sdk/sessions`로 독립 패키지화하여 선택적 사용 가능

### 배포 관련 고려사항
1. **패키지 네이밍**: `@robota-sdk/sessions` (직관적이고 기능 중심)
2. **버전 정책**: 기존 SDK와 동일한 semantic versioning
3. **배포 전략**: 알파/베타 버전을 통한 점진적 출시
4. **문서화**: 기존 robota.io 사이트에 통합
5. **마이그레이션**: 기존 사용자를 위한 마이그레이션 가이드 제공

## 📚 관련 문서
- [로드맵](../project/roadmap.ko.md) - 전체 프로젝트 계획
- [Robota Core API](../api-reference/core/) - 현재 Robota 클래스 구조
- [Development Guidelines](./development-guidelines.md) - 개발 가이드라인
- [패키지 배포 가이드](./package-deployment.md) - 패키지 배포 절차 (예정)

---

*마지막 업데이트: 2024년 12월* 