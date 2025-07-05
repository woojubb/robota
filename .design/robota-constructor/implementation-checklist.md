# Robota Constructor Refactoring - Implementation Checklist

## 📋 전체 수정 대상 파일 목록

### 🔥 핵심 인터페이스 및 클래스 (Critical Path)

#### 1. Agent 인터페이스 및 타입 정의
- [ ] `packages/agents/src/interfaces/agent.ts`
  - AgentConfig 인터페이스 완전 교체
  - RunOptions 인터페이스 검토
  - 관련 타입 정의 업데이트

#### 2. Robota 클래스 (메인 클래스)
- [ ] `packages/agents/src/agents/robota.ts`
  - 생성자 로직 완전 교체
  - setModel() 메서드 추가
  - getModel() 메서드 추가
  - switchProvider() 메서드 제거
  - registerProvider() 메서드 제거
  - updateConfig() 메서드 제거

#### 3. BaseAgent 추상 클래스
- [ ] `packages/agents/src/abstracts/base-agent.ts`
  - 제네릭 타입 매개변수 검토
  - 공통 메서드 시그니처 업데이트

### 🧪 테스트 파일들

#### 4. Robota 테스트
- [ ] `packages/agents/src/agents/robota.test.ts`
  - 모든 테스트 케이스 새로운 API로 수정
  - 새로운 setModel() 테스트 추가
  - 기존 switchProvider() 테스트 제거

#### 5. AgentFactory 테스트
- [ ] `packages/agents/src/managers/agent-factory.test.ts`
  - 새로운 AgentConfig 형식으로 수정
  - Provider 등록 방식 변경 반영

### 📚 예제 파일들

#### 6. 기본 예제들
- [ ] `apps/examples/01-basic-conversation.ts`
- [ ] `apps/examples/02-tool-calling.ts`
- [ ] `apps/examples/03-multi-providers.ts`
- [ ] `apps/examples/04-advanced-features.ts`
- [ ] `apps/examples/05-team-collaboration.ts`
- [ ] `apps/examples/05-team-collaboration-ko.ts`
- [ ] `apps/examples/06-payload-logging.ts`
- [ ] `apps/examples/07-team-templates.ts`
- [ ] `apps/examples/08-execution-analytics.ts`
- [ ] `apps/examples/10-agents-basic-usage.ts`
- [ ] `apps/examples/11-agents-streaming.ts`

### 🏗️ 관련 패키지들

#### 7. Sessions 패키지
- [ ] `packages/sessions/src/chat/chat-instance.ts`
  - Robota 인스턴스 생성 부분 수정
  - AgentConfig 사용 부분 업데이트

#### 8. Team 패키지
- [ ] `packages/team/src/create-team.ts`
  - AgentFactory 사용 부분 검토
  - 새로운 설정 방식 적용

#### 9. AgentFactory 및 관련 매니저들
- [ ] `packages/agents/src/managers/agent-factory.ts`
  - createAgent() 메서드 수정
  - 새로운 AgentConfig 형식 지원

### 📖 문서 파일들

#### 10. 패키지 문서들
- [ ] `packages/agents/docs/README.md`
- [ ] `packages/agents/docs/architecture.md`
- [ ] `packages/agents/docs/development.md`
- [ ] `packages/openai/docs/README.md`
- [ ] `packages/anthropic/docs/README.md`
- [ ] `packages/google/docs/README.md`
- [ ] `packages/sessions/docs/README.md`
- [ ] `packages/team/docs/README.md`

#### 11. 전체 프로젝트 문서들
- [ ] `README.md` (루트)
- [ ] `docs/examples/basic-conversation.md`
- [ ] `docs/examples/multi-provider.md`
- [ ] `docs/examples/session-management.md`
- [ ] `docs/guide/core-concepts.md`
- [ ] `docs/guide/building-agents.md`

### 🔧 설정 및 빌드 파일들

#### 12. TypeScript 설정
- [ ] `packages/agents/tsconfig.json` (타입 검사)
- [ ] `packages/sessions/tsconfig.json` (타입 검사)
- [ ] `packages/team/tsconfig.json` (타입 검사)

#### 13. 패키지 설정
- [ ] `packages/agents/package.json` (exports 확인)
- [ ] `packages/sessions/package.json` (의존성 확인)
- [ ] `packages/team/package.json` (의존성 확인)

## 🎯 우선순위별 구현 계획

### Phase 1: 핵심 API 변경 (Week 1)
```bash
# 우선순위 1: 핵심 인터페이스
packages/agents/src/interfaces/agent.ts
packages/agents/src/agents/robota.ts
packages/agents/src/abstracts/base-agent.ts

# 우선순위 2: 기본 테스트
packages/agents/src/agents/robota.test.ts
```

### Phase 2: 의존성 패키지 (Week 2)
```bash
# 우선순위 3: 관련 매니저들
packages/agents/src/managers/agent-factory.ts
packages/agents/src/managers/agent-factory.test.ts

# 우선순위 4: Sessions 패키지
packages/sessions/src/chat/chat-instance.ts
```

### Phase 3: 예제 및 문서 (Week 3)
```bash
# 우선순위 5: 예제들
apps/examples/*.ts

# 우선순위 6: 문서들
packages/*/docs/README.md
docs/examples/*.md
```

### Phase 4: 검증 및 최종 정리 (Week 4)
```bash
# 우선순위 7: Team 패키지
packages/team/src/create-team.ts

# 우선순위 8: 전체 빌드 및 테스트
pnpm build
pnpm test
```

## 📋 상세 구현 체크리스트

### Phase 1: 핵심 인터페이스 교체

#### 1.1 AgentConfig 인터페이스 수정
- [ ] `packages/agents/src/interfaces/agent.ts`
  ```typescript
  interface AgentConfig {
      name: string;
      aiProviders: AIProvider[];
      defaultModel: {
          provider: string;
          model: string;
          temperature?: number;
          maxTokens?: number;
          topP?: number;
          systemMessage?: string;
      };
      tools?: BaseTool[];
      plugins?: BasePlugin[];
      modules?: BaseModule[];
      logging?: LoggingConfig;
  }
  ```

#### 1.2 Robota 클래스 생성자 수정
- [ ] `packages/agents/src/agents/robota.ts`
  - [ ] 새로운 생성자 로직 구현
  - [ ] validateConfig() 메서드 추가
  - [ ] initializeProviders() 메서드 추가
  - [ ] applyDefaultModel() 메서드 추가

#### 1.3 새로운 런타임 메서드 구현
- [ ] `packages/agents/src/agents/robota.ts`
  - [ ] setModel() 메서드 추가
  - [ ] getModel() 메서드 추가
  - [ ] switchProvider() 메서드 제거
  - [ ] registerProvider() 메서드 제거
  - [ ] updateConfig() 메서드 제거

### Phase 2: 테스트 파일 수정

#### 2.1 Robota 테스트
- [ ] `packages/agents/src/agents/robota.test.ts`
  ```typescript
  describe('Robota Class - New Configuration', () => {
      let config: AgentConfig;
      
      beforeEach(() => {
          config = {
              name: 'Test Robota',
              aiProviders: [new MockAIProvider()],
              defaultModel: {
                  provider: 'mock-provider',
                  model: 'mock-model',
                  temperature: 0.7
              }
          };
      });
      
      it('should create with new configuration format', () => {
          const robota = new Robota(config);
          expect(robota.name).toBe('Test Robota');
      });
      
      it('should update model configuration', () => {
          const robota = new Robota(config);
          robota.setModel({
              provider: 'mock-provider',
              model: 'new-model',
              temperature: 0.9
          });
          
          const currentModel = robota.getModel();
          expect(currentModel.model).toBe('new-model');
      });
  });
  ```

### Phase 3: 예제 파일 수정

#### 3.1 기본 예제 업데이트
- [ ] `apps/examples/01-basic-conversation.ts`
  ```typescript
  const robota = new Robota({
      name: 'BasicAgent',
      aiProviders: [
          new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! })
      ],
      defaultModel: {
          provider: 'openai',
          model: 'gpt-4'
      }
  });
  ```

#### 3.2 다중 Provider 예제 업데이트
- [ ] `apps/examples/03-multi-providers.ts`
  ```typescript
  const robota = new Robota({
      name: 'MultiProviderAgent',
      aiProviders: [
          new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
          new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! })
      ],
      defaultModel: {
          provider: 'openai',
          model: 'gpt-4'
      }
  });
  
  // 런타임 모델 변경
  robota.setModel({
      provider: 'anthropic',
      model: 'claude-3-opus'
  });
  ```

### Phase 4: 관련 패키지 수정

#### 4.1 Sessions 패키지
- [ ] `packages/sessions/src/chat/chat-instance.ts`
  ```typescript
  export class ChatInstance {
      getRobotaConfig(): AgentConfig {
          return {
              name: 'default',
              aiProviders: [this.defaultProvider],
              defaultModel: {
                  provider: this.defaultProvider.name,
                  model: 'gpt-3.5-turbo'
              }
          };
      }
  }
  ```

#### 4.2 AgentFactory 수정
- [ ] `packages/agents/src/managers/agent-factory.ts`
  - [ ] createAgent() 메서드 새로운 AgentConfig 형식 지원
  - [ ] 기존 Provider 등록 방식 변경

## 🔍 검증 체크리스트

### 컴파일 검증
- [ ] `pnpm build` 모든 패키지 빌드 성공
- [ ] TypeScript 타입 에러 없음
- [ ] ESLint 에러 없음

### 테스트 검증
- [ ] `pnpm test` 모든 테스트 통과
- [ ] 새로운 API 테스트 케이스 추가
- [ ] 기존 API 테스트 케이스 제거

### 예제 검증
- [ ] 모든 예제 파일 실행 가능
- [ ] 새로운 API 사용법 정확히 반영
- [ ] 에러 처리 예제 포함

### 문서 검증
- [ ] API 문서 업데이트 완료
- [ ] 예제 문서 업데이트 완료
- [ ] Breaking Changes 문서 작성

## 🚨 주의사항

### 1. 타입 안전성 확보
```typescript
// 모든 곳에서 새로운 타입 사용
interface AgentConfig {
    aiProviders: AIProvider[];  // 배열로 통일
    defaultModel: {             // 객체로 구조화
        provider: string;
        model: string;
        // ...
    };
}
```

### 2. 에러 처리 강화
```typescript
// AI Provider 존재 확인
if (!availableProviders.includes(modelConfig.provider)) {
    throw new ConfigurationError(`AI Provider '${modelConfig.provider}' not found`);
}

// 중복 AI Provider 이름 확인
const duplicates = providerNames.filter((name, index) => 
    providerNames.indexOf(name) !== index
);
if (duplicates.length > 0) {
    throw new ConfigurationError(`Duplicate AI provider names: ${duplicates.join(', ')}`);
}
```

### 3. 완전한 Breaking Changes
```typescript
// ❌ 기존 방식 완전히 제거
// aiProviders?: Record<string, AIProvider>;
// currentProvider?: string;
// switchProvider(): void;
// registerProvider(): void;
// updateConfig(): void;
```

### 4. 문서 일관성 유지
- 모든 예제에서 새로운 API 사용
- 기존 API 언급 완전 제거
- Breaking Changes 명시적 문서화

## 🎯 최종 검증 기준

### 1. 새로운 API 완전 동작
- [ ] 새로운 생성자 방식으로 Robota 인스턴스 생성 성공
- [ ] setModel() / getModel() 메서드 정상 동작
- [ ] AI Provider 검증 로직 정상 동작

### 2. 기존 API 완전 제거
- [ ] 기존 생성자 옵션 사용 시 에러 발생
- [ ] 기존 런타임 메서드 호출 시 에러 발생
- [ ] 기존 방식 관련 코드 완전 제거

### 3. 전체 시스템 안정성
- [ ] 모든 패키지 빌드 성공
- [ ] 모든 테스트 통과
- [ ] 모든 예제 실행 성공

이 체크리스트를 따라 단계별로 구현하면 안전하고 체계적으로 리팩토링을 완료할 수 있습니다! 