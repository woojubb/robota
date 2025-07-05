# Planning 시스템 설계 패턴

> 이 문서는 Robota SDK Planning 시스템에서 사용되는 핵심 설계 패턴과 아키텍처 원칙을 설명합니다.

## 🏗️ 핵심 아키텍처 패턴

### 1. 추상 팩토리 패턴 (Abstract Factory Pattern)

플래너별 컴포넌트 생성을 위한 통일된 인터페이스를 제공합니다.

```typescript
// 추상 팩토리 인터페이스
interface PlannerFactory {
  createPlanner(config: PlannerConfiguration): BasePlanner;
  createExecutionEngine(planner: BasePlanner): ExecutionEngine;
  createMetricsCollector(planner: BasePlanner): MetricsCollector;
  getCapabilities(): PlannerCapabilities;
}

// CAMEL 플래너 전용 팩토리
class CAMELPlannerFactory implements PlannerFactory {
  createPlanner(config: PlannerConfiguration): CAMELPlanner {
    return new CAMELPlanner(config);
  }
  
  createExecutionEngine(planner: CAMELPlanner): CollaborativeExecutionEngine {
    return new CollaborativeExecutionEngine(planner);
  }
  
  createMetricsCollector(planner: CAMELPlanner): CollaborationMetricsCollector {
    return new CollaborationMetricsCollector();
  }
  
  getCapabilities(): PlannerCapabilities {
    return {
      supportsRoleBasedCollaboration: true,
      supportsWorkflowOrchestration: true,
      supportsQualityGates: true,
      maxConcurrentAgents: 10
    };
  }
}

// ReAct 플래너 전용 팩토리
class ReActPlannerFactory implements PlannerFactory {
  createPlanner(config: PlannerConfiguration): ReActPlanner {
    return new ReActPlanner(config);
  }
  
  createExecutionEngine(planner: ReActPlanner): ReasoningExecutionEngine {
    return new ReasoningExecutionEngine(planner);
  }
  
  createMetricsCollector(planner: ReActPlanner): ReasoningMetricsCollector {
    return new ReasoningMetricsCollector();
  }
  
  getCapabilities(): PlannerCapabilities {
    return {
      supportsIterativeReasoning: true,
      supportsToolDiscovery: true,
      supportsMetacognition: true,
      maxReasoningSteps: 20
    };
  }
}
```

### 2. 전략 패턴 (Strategy Pattern)

플래너 선택과 실행 전략을 동적으로 변경할 수 있도록 합니다.

```typescript
// 플래너 선택 전략 인터페이스
interface PlannerSelectionStrategy {
  selectPlanner(
    task: TaskDefinition,
    availablePlanners: Map<string, BasePlanner>,
    context: SelectionContext
  ): Promise<BasePlanner>;
}

// 최적 우선 선택 전략
class BestFirstSelectionStrategy implements PlannerSelectionStrategy {
  async selectPlanner(
    task: TaskDefinition,
    availablePlanners: Map<string, BasePlanner>,
    context: SelectionContext
  ): Promise<BasePlanner> {
    const taskAnalysis = await this.analyzeTask(task);
    
    // 작업 특성에 따른 플래너 점수 계산
    const plannerScores = new Map<string, number>();
    
    for (const [name, planner] of availablePlanners) {
      const capabilities = planner.getCapabilities();
      const score = this.calculateSuitabilityScore(taskAnalysis, capabilities);
      plannerScores.set(name, score);
    }
    
    // 가장 높은 점수의 플래너 선택
    const bestPlannerName = this.findHighestScore(plannerScores);
    return availablePlanners.get(bestPlannerName)!;
  }
  
  private calculateSuitabilityScore(
    taskAnalysis: TaskAnalysis,
    capabilities: PlannerCapabilities
  ): number {
    let score = 0;
    
    // 협업 필요성 점수
    if (taskAnalysis.requiresCollaboration && capabilities.supportsRoleBasedCollaboration) {
      score += 30;
    }
    
    // 탐색적 문제해결 점수
    if (taskAnalysis.requiresExploration && capabilities.supportsIterativeReasoning) {
      score += 25;
    }
    
    // 품질 개선 점수
    if (taskAnalysis.requiresQualityImprovement && capabilities.supportsReflection) {
      score += 20;
    }
    
    // 구조화된 처리 점수
    if (taskAnalysis.requiresStructuredApproach && capabilities.supportsSequentialPlanning) {
      score += 15;
    }
    
    return score;
  }
}

// 사용자 지정 선택 전략
class UserDefinedSelectionStrategy implements PlannerSelectionStrategy {
  constructor(private userPreferences: UserPlannerPreferences) {}
  
  async selectPlanner(
    task: TaskDefinition,
    availablePlanners: Map<string, BasePlanner>,
    context: SelectionContext
  ): Promise<BasePlanner> {
    // 사용자 선호도에 따른 선택
    const preferredPlannerName = this.userPreferences.getPreferredPlanner(task.category);
    
    if (availablePlanners.has(preferredPlannerName)) {
      return availablePlanners.get(preferredPlannerName)!;
    }
    
    // 폴백: 기본 전략 사용
    const fallbackStrategy = new BestFirstSelectionStrategy();
    return fallbackStrategy.selectPlanner(task, availablePlanners, context);
  }
}
```

### 3. 옵저버 패턴 (Observer Pattern)

실행 과정을 모니터링하고 이벤트를 처리합니다.

```typescript
// 실행 이벤트 인터페이스
interface ExecutionEvent {
  readonly type: ExecutionEventType;
  readonly timestamp: number;
  readonly plannerId: string;
  readonly sessionId: string;
  readonly data: Record<string, any>;
}

// 실행 관찰자 인터페이스
interface ExecutionObserver {
  onExecutionStart(event: ExecutionEvent): void;
  onExecutionProgress(event: ExecutionEvent): void;
  onExecutionComplete(event: ExecutionEvent): void;
  onExecutionError(event: ExecutionEvent): void;
}

// 실행 이벤트 발행자
class ExecutionEventPublisher {
  private observers: Set<ExecutionObserver> = new Set();
  
  subscribe(observer: ExecutionObserver): void {
    this.observers.add(observer);
  }
  
  unsubscribe(observer: ExecutionObserver): void {
    this.observers.delete(observer);
  }
  
  publish(event: ExecutionEvent): void {
    for (const observer of this.observers) {
      try {
        switch (event.type) {
          case ExecutionEventType.START:
            observer.onExecutionStart(event);
            break;
          case ExecutionEventType.PROGRESS:
            observer.onExecutionProgress(event);
            break;
          case ExecutionEventType.COMPLETE:
            observer.onExecutionComplete(event);
            break;
          case ExecutionEventType.ERROR:
            observer.onExecutionError(event);
            break;
        }
      } catch (error) {
        console.error('Observer error:', error);
      }
    }
  }
}

// 메트릭 수집 관찰자
class MetricsCollectionObserver implements ExecutionObserver {
  private metrics: Map<string, PlanningMetrics> = new Map();
  
  onExecutionStart(event: ExecutionEvent): void {
    const metrics = this.getOrCreateMetrics(event.plannerId);
    metrics.recordExecutionStart(event.sessionId, event.timestamp);
  }
  
  onExecutionComplete(event: ExecutionEvent): void {
    const metrics = this.getOrCreateMetrics(event.plannerId);
    metrics.recordExecutionComplete(
      event.sessionId,
      event.timestamp,
      event.data.result as ExecutionResult
    );
  }
  
  onExecutionError(event: ExecutionEvent): void {
    const metrics = this.getOrCreateMetrics(event.plannerId);
    metrics.recordExecutionError(
      event.sessionId,
      event.timestamp,
      event.data.error as Error
    );
  }
  
  private getOrCreateMetrics(plannerId: string): PlanningMetrics {
    if (!this.metrics.has(plannerId)) {
      this.metrics.set(plannerId, new PlanningMetrics(plannerId));
    }
    return this.metrics.get(plannerId)!;
  }
}
```

### 4. 체인 오브 리스폰시빌리티 패턴 (Chain of Responsibility)

요청 처리를 여러 핸들러로 연결하여 유연한 처리 체인을 구성합니다.

```typescript
// 요청 처리 핸들러 인터페이스
abstract class PlanningRequestHandler {
  protected nextHandler?: PlanningRequestHandler;
  
  setNext(handler: PlanningRequestHandler): PlanningRequestHandler {
    this.nextHandler = handler;
    return handler;
  }
  
  async handle(request: PlanningRequest): Promise<PlanningResponse> {
    const result = await this.process(request);
    
    if (result.needsContinuation && this.nextHandler) {
      const modifiedRequest = this.modifyRequest(request, result);
      return this.nextHandler.handle(modifiedRequest);
    }
    
    return result;
  }
  
  protected abstract process(request: PlanningRequest): Promise<PlanningResponse>;
  
  protected modifyRequest(
    original: PlanningRequest,
    result: PlanningResponse
  ): PlanningRequest {
    return {
      ...original,
      context: { ...original.context, previousResult: result }
    };
  }
}

// 작업 검증 핸들러
class TaskValidationHandler extends PlanningRequestHandler {
  protected async process(request: PlanningRequest): Promise<PlanningResponse> {
    const validationResult = await this.validateTask(request.task);
    
    if (!validationResult.isValid) {
      return {
        success: false,
        error: new ValidationError(validationResult.errors),
        needsContinuation: false
      };
    }
    
    return {
      success: true,
      data: { validatedTask: validationResult.normalizedTask },
      needsContinuation: true
    };
  }
  
  private async validateTask(task: TaskDefinition): Promise<TaskValidationResult> {
    // 작업 검증 로직
    return {
      isValid: task.description.length > 0,
      normalizedTask: this.normalizeTask(task),
      errors: []
    };
  }
}

// 플래너 선택 핸들러
class PlannerSelectionHandler extends PlanningRequestHandler {
  constructor(private selectionStrategy: PlannerSelectionStrategy) {
    super();
  }
  
  protected async process(request: PlanningRequest): Promise<PlanningResponse> {
    const availablePlanners = request.context.availablePlanners;
    const selectedPlanner = await this.selectionStrategy.selectPlanner(
      request.task,
      availablePlanners,
      request.context
    );
    
    return {
      success: true,
      data: { selectedPlanner },
      needsContinuation: true
    };
  }
}

// 실행 핸들러
class ExecutionHandler extends PlanningRequestHandler {
  protected async process(request: PlanningRequest): Promise<PlanningResponse> {
    const planner = request.context.previousResult?.data.selectedPlanner as BasePlanner;
    
    if (!planner) {
      return {
        success: false,
        error: new Error('No planner selected'),
        needsContinuation: false
      };
    }
    
    try {
      const plan = await planner.createPlan(request.task);
      const result = await planner.executePlan(plan);
      
      return {
        success: true,
        data: { executionResult: result },
        needsContinuation: false
      };
    } catch (error) {
      return {
        success: false,
        error: error as Error,
        needsContinuation: false
      };
    }
  }
}
```

### 5. 데코레이터 패턴 (Decorator Pattern)

플래너에 추가 기능을 동적으로 추가합니다.

```typescript
// 플래너 데코레이터 기본 클래스
abstract class PlannerDecorator implements BasePlanner {
  constructor(protected planner: BasePlanner) {}
  
  // 기본 메서드들은 위임
  async initialize(config: PlannerConfiguration): Promise<void> {
    return this.planner.initialize(config);
  }
  
  async createPlan(task: TaskDefinition): Promise<ExecutionPlan> {
    return this.planner.createPlan(task);
  }
  
  async executePlan(plan: ExecutionPlan): Promise<ExecutionResult> {
    return this.planner.executePlan(plan);
  }
  
  async cleanup(): Promise<void> {
    return this.planner.cleanup();
  }
  
  getCapabilities(): PlannerCapabilities {
    return this.planner.getCapabilities();
  }
}

// 캐싱 데코레이터
class CachingPlannerDecorator extends PlannerDecorator {
  private planCache: Map<string, ExecutionPlan> = new Map();
  private resultCache: Map<string, ExecutionResult> = new Map();
  
  async createPlan(task: TaskDefinition): Promise<ExecutionPlan> {
    const taskHash = this.hashTask(task);
    
    if (this.planCache.has(taskHash)) {
      return this.planCache.get(taskHash)!;
    }
    
    const plan = await super.createPlan(task);
    this.planCache.set(taskHash, plan);
    
    return plan;
  }
  
  async executePlan(plan: ExecutionPlan): Promise<ExecutionResult> {
    const planHash = this.hashPlan(plan);
    
    if (this.resultCache.has(planHash)) {
      return this.resultCache.get(planHash)!;
    }
    
    const result = await super.executePlan(plan);
    this.resultCache.set(planHash, result);
    
    return result;
  }
  
  private hashTask(task: TaskDefinition): string {
    return btoa(JSON.stringify(task));
  }
  
  private hashPlan(plan: ExecutionPlan): string {
    return btoa(JSON.stringify(plan));
  }
}

// 메트릭 수집 데코레이터
class MetricsCollectionDecorator extends PlannerDecorator {
  constructor(
    planner: BasePlanner,
    private metricsCollector: MetricsCollector
  ) {
    super(planner);
  }
  
  async createPlan(task: TaskDefinition): Promise<ExecutionPlan> {
    const startTime = Date.now();
    
    try {
      const plan = await super.createPlan(task);
      const duration = Date.now() - startTime;
      
      this.metricsCollector.recordPlanCreation({
        plannerId: this.planner.constructor.name,
        duration,
        success: true,
        planComplexity: this.calculatePlanComplexity(plan)
      });
      
      return plan;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.metricsCollector.recordPlanCreation({
        plannerId: this.planner.constructor.name,
        duration,
        success: false,
        error: error as Error
      });
      
      throw error;
    }
  }
  
  private calculatePlanComplexity(plan: ExecutionPlan): number {
    // 계획 복잡도 계산 로직
    return plan.steps?.length || 1;
  }
}

// 재시도 데코레이터
class RetryPlannerDecorator extends PlannerDecorator {
  constructor(
    planner: BasePlanner,
    private maxRetries: number = 3,
    private retryDelay: number = 1000
  ) {
    super(planner);
  }
  
  async executePlan(plan: ExecutionPlan): Promise<ExecutionResult> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await super.executePlan(plan);
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.maxRetries && this.isRetryableError(error as Error)) {
          await this.sleep(this.retryDelay * (attempt + 1)); // 지수 백오프
          continue;
        }
        
        break;
      }
    }
    
    throw lastError!;
  }
  
  private isRetryableError(error: Error): boolean {
    // 재시도 가능한 에러 판별
    return error.name === 'TemporaryFailureError' ||
           error.name === 'RateLimitError' ||
           error.name === 'NetworkError';
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

## 🎛️ 아키텍처 원칙

### 1. 단일 책임 원칙 (Single Responsibility Principle)

각 플래너는 하나의 명확한 책임을 가집니다.

```typescript
// ✅ 좋은 예: 단일 책임
class CAMELPlanner extends BasePlanner {
  // 오직 역할 기반 협업 플래닝에만 집중
  private roleManager: RoleManager;
  private collaborationEngine: CollaborationEngine;
  
  async createPlan(task: TaskDefinition): Promise<CAMELExecutionPlan> {
    // 역할 기반 협업 계획 생성
  }
}

class ReActPlanner extends BasePlanner {
  // 오직 추론-행동 반복 플래닝에만 집중
  private reasoningEngine: ReasoningEngine;
  private actionExecutor: ActionExecutor;
  
  async createPlan(task: TaskDefinition): Promise<ReActExecutionPlan> {
    // 추론-행동 계획 생성
  }
}

// ❌ 나쁜 예: 여러 책임
class UniversalPlanner extends BasePlanner {
  // 모든 유형의 플래닝을 하나의 클래스에서 처리 (X)
  async createPlan(task: TaskDefinition): Promise<ExecutionPlan> {
    if (task.type === 'collaboration') {
      // CAMEL 로직
    } else if (task.type === 'reasoning') {
      // ReAct 로직
    } else if (task.type === 'reflection') {
      // Reflection 로직
    }
    // ... 복잡하고 유지보수 어려움
  }
}
```

### 2. 개방-폐쇄 원칙 (Open-Closed Principle)

확장에는 열려있고 수정에는 닫혀있는 설계를 지향합니다.

```typescript
// ✅ 확장 가능한 설계
abstract class BasePlanner {
  // 공통 기능은 보호된 상태
  protected config: PlannerConfiguration;
  protected logger: Logger;
  
  // 확장 포인트는 추상 메서드로 제공
  abstract createPlan(task: TaskDefinition): Promise<ExecutionPlan>;
  abstract executePlan(plan: ExecutionPlan): Promise<ExecutionResult>;
  
  // 공통 기능은 재사용 가능
  protected validateTask(task: TaskDefinition): ValidationResult {
    return this.taskValidator.validate(task);
  }
}

// 새로운 플래너 추가 시 기존 코드 수정 없음
class HybridPlanner extends BasePlanner {
  async createPlan(task: TaskDefinition): Promise<ExecutionPlan> {
    // 새로운 하이브리드 플래닝 로직
    const subTasks = this.decomposeTask(task);
    const plannerAssignments = this.assignPlanners(subTasks);
    
    return new HybridExecutionPlan(plannerAssignments);
  }
  
  async executePlan(plan: HybridExecutionPlan): Promise<ExecutionResult> {
    // 하이브리드 실행 로직
    return this.orchestrateExecution(plan);
  }
}
```

### 3. 리스코프 치환 원칙 (Liskov Substitution Principle)

파생 클래스는 기본 클래스를 완전히 대체할 수 있어야 합니다.

```typescript
// ✅ 올바른 치환 가능성
class PlannerContainer {
  private planners: Map<string, BasePlanner> = new Map();
  
  async execute(task: TaskDefinition, plannerId?: string): Promise<ExecutionResult> {
    const planner = plannerId 
      ? this.planners.get(plannerId)
      : this.selectBestPlanner(task);
    
    if (!planner) {
      throw new Error('No suitable planner found');
    }
    
    // 모든 BasePlanner 구현체는 동일한 인터페이스로 사용 가능
    const plan = await planner.createPlan(task);
    return await planner.executePlan(plan);
  }
}

// ❌ 잘못된 예: 계약 위반
class BrokenPlanner extends BasePlanner {
  async createPlan(task: TaskDefinition): Promise<ExecutionPlan> {
    // 기본 클래스의 계약을 위반: null 반환
    return null as any; // 예상치 못한 동작
  }
}
```

### 4. 인터페이스 분리 원칙 (Interface Segregation Principle)

클라이언트가 사용하지 않는 인터페이스에 의존하지 않도록 합니다.

```typescript
// ✅ 분리된 인터페이스
interface PlanCreator {
  createPlan(task: TaskDefinition): Promise<ExecutionPlan>;
}

interface PlanExecutor {
  executePlan(plan: ExecutionPlan): Promise<ExecutionResult>;
}

interface PlanValidator {
  validatePlan(plan: ExecutionPlan): ValidationResult;
}

interface MetricsProvider {
  getMetrics(): PlanningMetrics;
}

// 플래너는 필요한 인터페이스만 구현
class CAMELPlanner implements PlanCreator, PlanExecutor, MetricsProvider {
  // 검증은 별도 컴포넌트에서 처리
}

// 검증 전용 컴포넌트
class PlanValidationService implements PlanValidator {
  validatePlan(plan: ExecutionPlan): ValidationResult {
    // 계획 검증 로직
  }
}

// ❌ 나쁜 예: 거대한 인터페이스
interface MegaPlanner {
  createPlan(task: TaskDefinition): Promise<ExecutionPlan>;
  executePlan(plan: ExecutionPlan): Promise<ExecutionResult>;
  validatePlan(plan: ExecutionPlan): ValidationResult;
  getMetrics(): PlanningMetrics;
  generateReport(): PlanningReport;
  exportData(): ExportData;
  importData(data: ImportData): void;
  // ... 너무 많은 책임
}
```

### 5. 의존성 역전 원칙 (Dependency Inversion Principle)

고수준 모듈이 저수준 모듈에 의존하지 않도록 합니다.

```typescript
// ✅ 의존성 주입을 통한 역전
interface AgentFactoryInterface {
  createAgent(config: AgentConfig): Promise<AgentInterface>;
}

interface ToolRegistryInterface {
  getTool(toolId: string): Promise<ToolInterface>;
}

class CAMELPlanner extends BasePlanner {
  constructor(
    // 추상화에 의존
    private agentFactory: AgentFactoryInterface,
    private toolRegistry: ToolRegistryInterface,
    private logger: LoggerInterface
  ) {
    super();
  }
  
  async createPlan(task: TaskDefinition): Promise<CAMELExecutionPlan> {
    // 구체적 구현이 아닌 인터페이스 사용
    const agents = await this.agentFactory.createAgent(agentConfig);
    const tools = await this.toolRegistry.getTool(toolId);
    
    return this.buildCollaborativePlan(agents, tools);
  }
}

// ❌ 나쁜 예: 구체적 클래스에 직접 의존
class BadCAMELPlanner extends BasePlanner {
  private agentFactory = new ConcreteAgentFactory(); // 구체적 클래스에 의존
  private toolRegistry = new FileBasedToolRegistry(); // 구체적 구현에 의존
  
  // 테스트와 확장이 어려움
}
```

## 🔄 컴포지션 패턴

### 플래너 조합 및 체이닝

```typescript
// 플래너 조합을 위한 컴포지트 패턴
class CompositePlanner extends BasePlanner {
  private planners: BasePlanner[] = [];
  private orchestrationStrategy: OrchestrationStrategy;
  
  constructor(orchestrationStrategy: OrchestrationStrategy) {
    super();
    this.orchestrationStrategy = orchestrationStrategy;
  }
  
  addPlanner(planner: BasePlanner): void {
    this.planners.push(planner);
  }
  
  async createPlan(task: TaskDefinition): Promise<CompositeExecutionPlan> {
    const subTasks = this.decomposeTask(task);
    const subPlans: ExecutionPlan[] = [];
    
    for (let i = 0; i < subTasks.length && i < this.planners.length; i++) {
      const subPlan = await this.planners[i].createPlan(subTasks[i]);
      subPlans.push(subPlan);
    }
    
    return new CompositeExecutionPlan(subPlans, this.orchestrationStrategy);
  }
  
  async executePlan(plan: CompositeExecutionPlan): Promise<ExecutionResult> {
    return this.orchestrationStrategy.execute(plan, this.planners);
  }
}

// 오케스트레이션 전략
interface OrchestrationStrategy {
  execute(plan: CompositeExecutionPlan, planners: BasePlanner[]): Promise<ExecutionResult>;
}

class SequentialOrchestrationStrategy implements OrchestrationStrategy {
  async execute(plan: CompositeExecutionPlan, planners: BasePlanner[]): Promise<ExecutionResult> {
    const results: ExecutionResult[] = [];
    
    for (let i = 0; i < plan.subPlans.length; i++) {
      const result = await planners[i].executePlan(plan.subPlans[i]);
      results.push(result);
    }
    
    return this.combineResults(results);
  }
}

class ParallelOrchestrationStrategy implements OrchestrationStrategy {
  async execute(plan: CompositeExecutionPlan, planners: BasePlanner[]): Promise<ExecutionResult> {
    const promises = plan.subPlans.map((subPlan, index) => 
      planners[index].executePlan(subPlan)
    );
    
    const results = await Promise.all(promises);
    return this.combineResults(results);
  }
}
```

## 📊 성능 최적화 패턴

### 1. 객체 풀 패턴 (Object Pool Pattern)

```typescript
// 에이전트 객체 풀
class AgentPool {
  private available: AgentInterface[] = [];
  private inUse: Set<AgentInterface> = new Set();
  private maxSize: number;
  
  constructor(private agentFactory: AgentFactoryInterface, maxSize: number = 10) {
    this.maxSize = maxSize;
  }
  
  async acquire(config: AgentConfig): Promise<AgentInterface> {
    // 사용 가능한 에이전트 찾기
    const availableAgent = this.findCompatibleAgent(config);
    
    if (availableAgent) {
      this.available.splice(this.available.indexOf(availableAgent), 1);
      this.inUse.add(availableAgent);
      await availableAgent.reconfigure(config);
      return availableAgent;
    }
    
    // 새 에이전트 생성 (풀 크기 제한 고려)
    if (this.getTotalSize() < this.maxSize) {
      const newAgent = await this.agentFactory.createAgent(config);
      this.inUse.add(newAgent);
      return newAgent;
    }
    
    // 풀이 가득 찬 경우 대기
    return this.waitForAvailableAgent(config);
  }
  
  release(agent: AgentInterface): void {
    if (this.inUse.has(agent)) {
      this.inUse.delete(agent);
      this.available.push(agent);
    }
  }
  
  private findCompatibleAgent(config: AgentConfig): AgentInterface | null {
    return this.available.find(agent => agent.isCompatibleWith(config)) || null;
  }
}
```

### 2. 레이지 로딩 패턴 (Lazy Loading Pattern)

```typescript
// 지연 로딩을 사용한 플래너
class LazyLoadedPlannerContainer {
  private plannerFactories: Map<string, () => Promise<BasePlanner>> = new Map();
  private loadedPlanners: Map<string, BasePlanner> = new Map();
  
  registerPlanner(name: string, factory: () => Promise<BasePlanner>): void {
    this.plannerFactories.set(name, factory);
  }
  
  async getPlanner(name: string): Promise<BasePlanner> {
    // 이미 로드된 플래너 반환
    if (this.loadedPlanners.has(name)) {
      return this.loadedPlanners.get(name)!;
    }
    
    // 필요할 때만 플래너 생성
    const factory = this.plannerFactories.get(name);
    if (!factory) {
      throw new Error(`Unknown planner: ${name}`);
    }
    
    const planner = await factory();
    this.loadedPlanners.set(name, planner);
    
    return planner;
  }
}
```

## 📚 관련 문서

### 코어 시스템
- [Planning System Overview](../core-system/planning-overview.md) - 전체 시스템 개요
- [Planning Container](../core-system/planning-container.md) - 플래너 통합 관리
- [AgentFactory 확장](../core-system/agentfactory-expansion.md) - 에이전트 생성 엔진

### 플래너별 설계
- [CAMEL Planner](../planners/camel-planner.md) - 역할 기반 협업
- [ReAct Planner](../planners/react-planner.md) - 추론+행동 반복
- [Reflection Planner](../planners/reflection-planner.md) - 품질 개선 중심
- [Sequential Planner](../planners/sequential-planner.md) - 단계별 처리

### 도구 관리
- [도구 아키텍처](../tool-management/tool-architecture.md) - 도구 관리 전략
- [도구 구현](../tool-management/tool-implementation.md) - 구체적 구현 방법

### 구현 가이드
- [구현 로드맵](../implementation/implementation-roadmap.md) - 개발 계획
- [마이그레이션 가이드](../implementation/migration-guide.md) - Team → Planning 전환
- [사용 예제](../implementation/usage-examples.md) - 실제 사용 사례

### 아키텍처
- [시스템 분석](./system-analysis.md) - 현재 시스템 분석

이러한 설계 패턴들을 통해 Planning 시스템은 확장 가능하고, 유지보수 가능하며, 성능이 최적화된 아키텍처를 제공합니다. 