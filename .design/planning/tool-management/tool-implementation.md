# 도구 구현 가이드: Planning 시스템 도구 개발

> 이 문서는 [도구 아키텍처](./tool-architecture.md)의 구체적 구현 방법에 대한 상세 가이드입니다.

## 🎯 개요

Planning 시스템의 도구 구현은 **표준화된 인터페이스**와 **플러그인 아키텍처**를 기반으로 합니다. 각 도구는 독립적으로 개발되어 시스템에 통합될 수 있으며, 런타임에 동적으로 로드 및 관리됩니다.

## 🏗️ 도구 구현 아키텍처

### 기본 도구 인터페이스
```typescript
// 모든 도구가 구현해야 하는 기본 인터페이스
interface PlanningToolInterface {
  // 도구 메타데이터
  readonly toolId: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly toolCategory: ToolCategory;
  readonly supportedPlanners: PlannerType[];
  
  // 도구 라이프사이클
  initialize(config: ToolInitializationConfig): Promise<void>;
  execute(input: ToolExecutionInput): Promise<ToolExecutionResult>;
  cleanup(): Promise<void>;
  
  // 상태 관리
  getStatus(): ToolStatus;
  getMetrics(): ToolMetrics;
  
  // 설정 관리
  updateConfiguration(config: Partial<ToolConfiguration>): Promise<void>;
  validateConfiguration(config: ToolConfiguration): ValidationResult;
}

// 도구 카테고리 정의
enum ToolCategory {
  CORE = 'core',
  COLLABORATION = 'collaboration',
  ANALYSIS = 'analysis',
  QUALITY = 'quality',
  COMMUNICATION = 'communication',
  SPECIALIZED = 'specialized'
}

// 플래너 타입 정의
enum PlannerType {
  CAMEL = 'camel',
  REACT = 'react',
  REFLECTION = 'reflection',
  SEQUENTIAL = 'sequential',
  ALL = 'all'
}
```

### 추상 도구 기본 클래스
```typescript
// 공통 기능을 제공하는 추상 기본 클래스
abstract class BasePlanningTool implements PlanningToolInterface {
  protected config: ToolConfiguration;
  protected status: ToolStatus = ToolStatus.UNINITIALIZED;
  protected metrics: ToolMetrics = new ToolMetrics();
  
  // 추상 메서드 - 하위 클래스에서 구현 필수
  abstract get toolId(): string;
  abstract get toolName(): string;
  abstract get toolCategory(): ToolCategory;
  abstract get supportedPlanners(): PlannerType[];
  
  protected abstract doExecute(input: ToolExecutionInput): Promise<ToolExecutionResult>;
  protected abstract doInitialize(config: ToolInitializationConfig): Promise<void>;
  
  // 공통 구현
  async initialize(config: ToolInitializationConfig): Promise<void> {
    this.validateInitializationConfig(config);
    this.status = ToolStatus.INITIALIZING;
    
    try {
      await this.doInitialize(config);
      this.status = ToolStatus.READY;
      this.metrics.recordInitialization();
    } catch (error) {
      this.status = ToolStatus.ERROR;
      throw new ToolInitializationError(`Failed to initialize ${this.toolName}`, error);
    }
  }
  
  async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
    this.validateExecutionInput(input);
    this.ensureReady();
    
    const startTime = Date.now();
    this.metrics.recordExecutionStart();
    
    try {
      const result = await this.doExecute(input);
      const executionTime = Date.now() - startTime;
      
      this.metrics.recordExecutionSuccess(executionTime);
      return this.wrapResult(result, executionTime);
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metrics.recordExecutionFailure(executionTime, error);
      throw new ToolExecutionError(`${this.toolName} execution failed`, error);
    }
  }
  
  getStatus(): ToolStatus {
    return this.status;
  }
  
  getMetrics(): ToolMetrics {
    return this.metrics.clone();
  }
  
  async cleanup(): Promise<void> {
    this.status = ToolStatus.CLEANING_UP;
    await this.doCleanup();
    this.status = ToolStatus.DISPOSED;
  }
  
  protected async doCleanup(): Promise<void> {
    // 기본 정리 작업 (필요시 하위 클래스에서 오버라이드)
  }
}
```

## 🔧 구체적 도구 구현 예제

### 1. 웹 검색 도구 구현
```typescript
// 웹 검색 도구 구현 예제
class WebSearchTool extends BasePlanningTool {
  private searchEngine: SearchEngineInterface;
  private rateLimiter: RateLimiter;
  
  get toolId(): string { return 'web_search_v1'; }
  get toolName(): string { return 'Web Search Tool'; }
  get toolCategory(): ToolCategory { return ToolCategory.CORE; }
  get supportedPlanners(): PlannerType[] { return [PlannerType.ALL]; }
  
  protected async doInitialize(config: ToolInitializationConfig): Promise<void> {
    // 검색 엔진 초기화
    this.searchEngine = new SearchEngine({
      apiKey: config.apiKey,
      maxResults: config.maxResults || 10,
      timeout: config.timeout || 30000
    });
    
    // 속도 제한 설정
    this.rateLimiter = new RateLimiter({
      requestsPerMinute: config.rateLimitRpm || 60,
      burstLimit: config.burstLimit || 10
    });
    
    await this.searchEngine.initialize();
  }
  
  protected async doExecute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
    const { query, options = {} } = input.parameters;
    
    // 속도 제한 확인
    await this.rateLimiter.waitForSlot();
    
    // 검색 실행
    const searchResults = await this.searchEngine.search(query, {
      maxResults: options.maxResults || 5,
      language: options.language || 'en',
      region: options.region || 'global',
      safeSearch: options.safeSearch || 'moderate'
    });
    
    // 결과 후처리
    const processedResults = await this.processSearchResults(searchResults);
    
    return {
      success: true,
      data: {
        query,
        results: processedResults,
        totalResults: searchResults.totalCount,
        searchTime: searchResults.searchTime
      },
      metadata: {
        toolId: this.toolId,
        executionTime: Date.now() - input.startTime,
        resourcesUsed: ['search_api', 'rate_limiter']
      }
    };
  }
  
  private async processSearchResults(results: SearchResult[]): Promise<ProcessedSearchResult[]> {
    return Promise.all(results.map(async (result) => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      relevanceScore: await this.calculateRelevance(result),
      extractedData: await this.extractStructuredData(result)
    })));
  }
}
```

### 2. 품질 검증 도구 구현
```typescript
// 품질 검증 도구 구현 예제
class QualityValidatorTool extends BasePlanningTool {
  private validators: Map<string, ValidatorInterface> = new Map();
  
  get toolId(): string { return 'quality_validator_v1'; }
  get toolName(): string { return 'Quality Validator Tool'; }
  get toolCategory(): ToolCategory { return ToolCategory.QUALITY; }
  get supportedPlanners(): PlannerType[] { 
    return [PlannerType.REFLECTION, PlannerType.SEQUENTIAL]; 
  }
  
  protected async doInitialize(config: ToolInitializationConfig): Promise<void> {
    // 다양한 검증기 초기화
    this.validators.set('grammar', new GrammarValidator(config.grammar));
    this.validators.set('factual', new FactualValidator(config.factual));
    this.validators.set('coherence', new CoherenceValidator(config.coherence));
    this.validators.set('completeness', new CompletenessValidator(config.completeness));
    
    // 모든 검증기 초기화
    await Promise.all(
      Array.from(this.validators.values()).map(validator => validator.initialize())
    );
  }
  
  protected async doExecute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
    const { content, validationTypes = ['all'], context } = input.parameters;
    
    // 요청된 검증 타입 결정
    const requestedValidators = validationTypes.includes('all') 
      ? Array.from(this.validators.keys())
      : validationTypes;
    
    // 병렬 검증 실행
    const validationResults = await Promise.all(
      requestedValidators.map(async (type) => {
        const validator = this.validators.get(type);
        if (!validator) {
          throw new Error(`Unknown validation type: ${type}`);
        }
        
        const result = await validator.validate(content, context);
        return { type, result };
      })
    );
    
    // 종합 품질 점수 계산
    const overallScore = this.calculateOverallScore(validationResults);
    const issues = this.extractIssues(validationResults);
    const recommendations = this.generateRecommendations(issues);
    
    return {
      success: true,
      data: {
        overallScore,
        detailedScores: validationResults.reduce((acc, { type, result }) => {
          acc[type] = result.score;
          return acc;
        }, {}),
        issues,
        recommendations,
        validationSummary: this.createValidationSummary(validationResults)
      },
      metadata: {
        toolId: this.toolId,
        validatorsUsed: requestedValidators,
        contentLength: content.length
      }
    };
  }
}
```

### 3. 협업 조정 도구 구현
```typescript
// 협업 조정 도구 구현 예제 (CAMEL 플래너 특화)
class CollaborationCoordinatorTool extends BasePlanningTool {
  private communicationHub: CommunicationHub;
  private progressTracker: ProgressTracker;
  private conflictResolver: ConflictResolver;
  
  get toolId(): string { return 'collaboration_coordinator_v1'; }
  get toolName(): string { return 'Collaboration Coordinator Tool'; }
  get toolCategory(): ToolCategory { return ToolCategory.COLLABORATION; }
  get supportedPlanners(): PlannerType[] { return [PlannerType.CAMEL]; }
  
  protected async doInitialize(config: ToolInitializationConfig): Promise<void> {
    this.communicationHub = new CommunicationHub({
      maxParticipants: config.maxAgents || 10,
      messageQueueSize: config.queueSize || 1000,
      timeout: config.communicationTimeout || 30000
    });
    
    this.progressTracker = new ProgressTracker({
      trackingInterval: config.trackingInterval || 5000,
      metricsRetention: config.metricsRetention || 24 * 60 * 60 * 1000 // 24시간
    });
    
    this.conflictResolver = new ConflictResolver({
      resolutionStrategies: config.conflictStrategies || ['consensus', 'authority', 'voting'],
      timeoutMs: config.conflictTimeout || 60000
    });
    
    await this.communicationHub.initialize();
    await this.progressTracker.initialize();
  }
  
  protected async doExecute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
    const { action, participants, data } = input.parameters;
    
    switch (action) {
      case 'coordinate_task':
        return await this.coordinateTask(participants, data);
      
      case 'resolve_conflict':
        return await this.resolveConflict(participants, data);
      
      case 'track_progress':
        return await this.trackProgress(participants, data);
      
      case 'facilitate_communication':
        return await this.facilitateCommunication(participants, data);
      
      default:
        throw new Error(`Unknown coordination action: ${action}`);
    }
  }
  
  private async coordinateTask(
    participants: AgentParticipant[], 
    taskData: TaskCoordinationData
  ): Promise<ToolExecutionResult> {
    // 작업 분배 계획 수립
    const distributionPlan = await this.createDistributionPlan(participants, taskData);
    
    // 각 참가자에게 작업 할당
    const assignments = await Promise.all(
      distributionPlan.assignments.map(async (assignment) => {
        const result = await this.communicationHub.sendTaskAssignment(
          assignment.participantId,
          assignment.task
        );
        return { ...assignment, acknowledged: result.acknowledged };
      })
    );
    
    // 진행 상황 추적 시작
    const trackingId = await this.progressTracker.startTracking(taskData.taskId, assignments);
    
    return {
      success: true,
      data: {
        taskId: taskData.taskId,
        distributionPlan,
        assignments,
        trackingId,
        estimatedCompletion: distributionPlan.estimatedCompletion
      }
    };
  }
}
```

## 🔌 도구 플러그인 시스템

### 도구 레지스트리
```typescript
// 도구 동적 로딩 및 관리 시스템
class PlanningToolRegistry {
  private tools: Map<string, PlanningToolInterface> = new Map();
  private toolFactories: Map<string, ToolFactory> = new Map();
  private loadedPlugins: Map<string, PluginInfo> = new Map();
  
  async registerTool(toolFactory: ToolFactory): Promise<void> {
    const toolInfo = toolFactory.getToolInfo();
    
    // 도구 정보 검증
    this.validateToolInfo(toolInfo);
    
    // 의존성 확인
    await this.checkDependencies(toolInfo.dependencies);
    
    // 팩토리 등록
    this.toolFactories.set(toolInfo.toolId, toolFactory);
    
    console.log(`Tool registered: ${toolInfo.toolId} v${toolInfo.version}`);
  }
  
  async loadTool(toolId: string, config: ToolInitializationConfig): Promise<PlanningToolInterface> {
    const factory = this.toolFactories.get(toolId);
    if (!factory) {
      throw new Error(`Tool not found: ${toolId}`);
    }
    
    // 도구 인스턴스 생성
    const tool = await factory.createTool();
    
    // 초기화
    await tool.initialize(config);
    
    // 레지스트리에 추가
    this.tools.set(toolId, tool);
    
    return tool;
  }
  
  async unloadTool(toolId: string): Promise<void> {
    const tool = this.tools.get(toolId);
    if (tool) {
      await tool.cleanup();
      this.tools.delete(toolId);
    }
  }
  
  getAvailableTools(plannerType?: PlannerType): ToolInfo[] {
    return Array.from(this.toolFactories.values())
      .map(factory => factory.getToolInfo())
      .filter(info => !plannerType || 
        info.supportedPlanners.includes(plannerType) || 
        info.supportedPlanners.includes(PlannerType.ALL)
      );
  }
  
  async loadPlugin(pluginPath: string): Promise<void> {
    // 플러그인 로드
    const plugin = await import(pluginPath);
    
    // 플러그인 검증
    this.validatePlugin(plugin);
    
    // 플러그인 초기화
    await plugin.initialize();
    
    // 플러그인의 도구들 등록
    const tools = plugin.getTools();
    await Promise.all(tools.map(tool => this.registerTool(tool)));
    
    // 플러그인 정보 저장
    this.loadedPlugins.set(plugin.pluginId, {
      pluginId: plugin.pluginId,
      version: plugin.version,
      path: pluginPath,
      tools: tools.map(t => t.getToolInfo().toolId)
    });
  }
}
```

### 도구 팩토리 패턴
```typescript
// 도구 생성을 위한 팩토리 인터페이스
interface ToolFactory {
  getToolInfo(): ToolInfo;
  createTool(): Promise<PlanningToolInterface>;
  validateConfiguration(config: ToolConfiguration): ValidationResult;
}

// 웹 검색 도구 팩토리 구현
class WebSearchToolFactory implements ToolFactory {
  getToolInfo(): ToolInfo {
    return {
      toolId: 'web_search_v1',
      name: 'Web Search Tool',
      version: '1.0.0',
      category: ToolCategory.CORE,
      supportedPlanners: [PlannerType.ALL],
      dependencies: ['search_engine_api'],
      configurationSchema: {
        apiKey: { type: 'string', required: true },
        maxResults: { type: 'number', default: 10 },
        timeout: { type: 'number', default: 30000 }
      }
    };
  }
  
  async createTool(): Promise<PlanningToolInterface> {
    return new WebSearchTool();
  }
  
  validateConfiguration(config: ToolConfiguration): ValidationResult {
    const schema = this.getToolInfo().configurationSchema;
    return validateAgainstSchema(config, schema);
  }
}
```

## 🔄 도구 통합 및 배포

### 도구 패키징
```typescript
// 도구 패키지 정의
interface ToolPackage {
  packageInfo: {
    name: string;
    version: string;
    description: string;
    author: string;
    license: string;
  };
  
  tools: ToolFactory[];
  dependencies: PackageDependency[];
  configuration: PackageConfiguration;
  
  // 패키지 라이프사이클
  install(): Promise<void>;
  uninstall(): Promise<void>;
  update(newVersion: string): Promise<void>;
}

// 도구 패키지 매니저
class ToolPackageManager {
  private installedPackages: Map<string, ToolPackage> = new Map();
  private registry: PlanningToolRegistry;
  
  constructor(registry: PlanningToolRegistry) {
    this.registry = registry;
  }
  
  async installPackage(packagePath: string): Promise<void> {
    // 패키지 로드
    const packageModule = await import(packagePath);
    const toolPackage: ToolPackage = packageModule.default;
    
    // 의존성 확인
    await this.resolveDependencies(toolPackage.dependencies);
    
    // 패키지 설치
    await toolPackage.install();
    
    // 도구들을 레지스트리에 등록
    await Promise.all(
      toolPackage.tools.map(factory => this.registry.registerTool(factory))
    );
    
    // 설치된 패키지 목록에 추가
    this.installedPackages.set(toolPackage.packageInfo.name, toolPackage);
    
    console.log(`Package installed: ${toolPackage.packageInfo.name} v${toolPackage.packageInfo.version}`);
  }
  
  async uninstallPackage(packageName: string): Promise<void> {
    const toolPackage = this.installedPackages.get(packageName);
    if (!toolPackage) {
      throw new Error(`Package not found: ${packageName}`);
    }
    
    // 패키지 제거
    await toolPackage.uninstall();
    
    // 레지스트리에서 도구들 제거
    for (const factory of toolPackage.tools) {
      const toolInfo = factory.getToolInfo();
      await this.registry.unloadTool(toolInfo.toolId);
    }
    
    // 설치된 패키지 목록에서 제거
    this.installedPackages.delete(packageName);
    
    console.log(`Package uninstalled: ${packageName}`);
  }
}
```

## 📊 도구 성능 모니터링

### 도구 메트릭 수집
```typescript
// 도구 성능 메트릭 클래스
class ToolMetrics {
  private executionHistory: ExecutionRecord[] = [];
  private performanceStats: PerformanceStats = new PerformanceStats();
  
  recordExecutionStart(): void {
    this.performanceStats.totalExecutions++;
    this.performanceStats.lastExecutionStart = Date.now();
  }
  
  recordExecutionSuccess(executionTime: number): void {
    this.performanceStats.successfulExecutions++;
    this.performanceStats.totalExecutionTime += executionTime;
    this.performanceStats.averageExecutionTime = 
      this.performanceStats.totalExecutionTime / this.performanceStats.successfulExecutions;
    
    this.executionHistory.push({
      timestamp: Date.now(),
      executionTime,
      success: true
    });
    
    this.maintainHistorySize();
  }
  
  recordExecutionFailure(executionTime: number, error: Error): void {
    this.performanceStats.failedExecutions++;
    this.performanceStats.lastError = {
      message: error.message,
      timestamp: Date.now()
    };
    
    this.executionHistory.push({
      timestamp: Date.now(),
      executionTime,
      success: false,
      error: error.message
    });
    
    this.maintainHistorySize();
  }
  
  getSuccessRate(): number {
    const total = this.performanceStats.totalExecutions;
    return total > 0 ? this.performanceStats.successfulExecutions / total : 0;
  }
  
  getPerformanceTrend(): PerformanceTrend {
    if (this.executionHistory.length < 10) {
      return PerformanceTrend.INSUFFICIENT_DATA;
    }
    
    const recent = this.executionHistory.slice(-10);
    const older = this.executionHistory.slice(-20, -10);
    
    const recentAvg = recent.reduce((sum, record) => sum + record.executionTime, 0) / recent.length;
    const olderAvg = older.reduce((sum, record) => sum + record.executionTime, 0) / older.length;
    
    if (recentAvg < olderAvg * 0.9) return PerformanceTrend.IMPROVING;
    if (recentAvg > olderAvg * 1.1) return PerformanceTrend.DEGRADING;
    return PerformanceTrend.STABLE;
  }
}
```

## 📚 관련 문서

### 도구 관리
- [도구 아키텍처](./tool-architecture.md) - 도구 관리 전략

### 코어 시스템
- [Planning System Overview](../core-system/planning-overview.md) - 전체 시스템 개요
- [AgentFactory 확장](../core-system/agentfactory-expansion.md) - 에이전트 생성 엔진

### 플래너별 전략
- [CAMEL Planner](../planners/camel-planner.md) - 역할 기반 협업
- [ReAct Planner](../planners/react-planner.md) - 추론+행동 반복
- [Reflection Planner](../planners/reflection-planner.md) - 품질 개선 중심
- [Sequential Planner](../planners/sequential-planner.md) - 단계별 처리

### 구현 가이드
- [구현 로드맵](../implementation/implementation-roadmap.md) - 개발 계획
- [사용 예제](../implementation/usage-examples.md) - 실제 사용 사례 