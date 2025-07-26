/**
 * PlaygroundHistoryPlugin - Robota SDK Compliant Plugin for Browser
 * 
 * Follows Robota SDK Architecture Principles:
 * - Extends BasePlugin<TOptions, TStats> with proper types
 * - Implements enable/disable options (enabled: false, strategy: 'silent')
 * - Provides comprehensive validation with actionable errors
 * - Uses category and priority system
 * - Dependency injection pattern for logging
 * - Single responsibility: History capture and visualization only
 */

import {
    BasePlugin,
    BasePluginOptions,
    PluginStats,
    PluginCategory,
    PluginPriority,
    SimpleLogger,
    SilentLogger
} from '@robota-sdk/agents';

// 🎯 기본 이벤트 타입 (단순화된 5개 타입)
type BasicEventType =
    | 'user_message'      // 사용자 입력
    | 'assistant_response' // LLM 응답  
    | 'tool_call'         // 도구 호출
    | 'tool_result'       // 도구 결과
    | 'error';            // 오류

// 🏗️ 계층 구조 중심의 ConversationEvent
export interface ConversationEvent {
    // 기본 필드들
    id: string;
    type: BasicEventType; // ✅ 단순한 5개 타입만
    timestamp: Date;
    content?: string;

    // 🎯 계층 구조 핵심 필드들
    parentEventId?: string;   // 부모 이벤트 참조
    childEventIds: string[];  // 자식 이벤트들 (자동 관리)
    executionLevel: number;   // 0=Team, 1=Tool, 2=Sub-Agent, 3=Sub-Tool
    executionPath: string;    // 'team→assignTask→agent_abc→webSearch'

    // 🔧 컨텍스트 추적
    agentId?: string;         // 실행 중인 Agent ID
    toolName?: string;        // 실행 중인 Tool 이름
    delegationId?: string;    // assignTask 호출 고유 ID
    parameters?: Record<string, unknown>;
    result?: unknown;
    error?: string;
    metadata?: Record<string, unknown>;
}

// 플러그인 옵션 인터페이스 (단순화)
export interface PlaygroundHistoryPluginOptions extends BasePluginOptions {
    maxEvents?: number;
    enableVisualization?: boolean;
    logger?: SimpleLogger;
}

// 플러그인 통계 인터페이스
export interface PlaygroundHistoryPluginStats extends PluginStats {
    totalEvents: number;
    userMessages: number;
    assistantResponses: number;
    toolCalls: number;
    toolResults: number;
    errorEvents: number;
    totalAgents: number;
    maxExecutionLevel: number;
}

// Agent 블록 인터페이스 (UI용)
export interface AgentBlock {
    id: string;
    name: string;
    status: 'idle' | 'running' | 'completed' | 'error';
    startTime?: Date;
    endTime?: Date;
    events: ConversationEvent[];
}

// 시각화 데이터 인터페이스
export interface VisualizationData {
    events: ConversationEvent[];
    mode: 'agent' | 'team';
    agents: AgentBlock[];
    currentExecution?: {
        agentId: string;
        startTime: Date;
        status: 'running' | 'completed' | 'error';
    };
}

// 🚀 공식 BasePlugin을 상속하는 PlaygroundHistoryPlugin
export class PlaygroundHistoryPlugin extends BasePlugin<PlaygroundHistoryPluginOptions, PlaygroundHistoryPluginStats> {
    readonly name = 'PlaygroundHistoryPlugin';
    readonly version = '1.0.0';

    // 플러그인 분류
    public category = PluginCategory.MONITORING;
    public priority = PluginPriority.HIGH;

    // 이벤트 저장소
    private events: ConversationEvent[] = [];
    private relationshipTracker = new Map<string, string[]>();

    // Agent 관리
    private mode: 'agent' | 'team' = 'agent';
    private agents: AgentBlock[] = [];

    // 로거 (의존성 주입)
    private logger: SimpleLogger;

    constructor(options?: PlaygroundHistoryPluginOptions) {
        super();

        // 🎯 의존성 주입 패턴 - 공식 SDK 스타일
        this.logger = options?.logger || SilentLogger;

        // 플러그인 분류 설정
        this.category = PluginCategory.MONITORING;
        this.priority = PluginPriority.HIGH;

        // 옵션 검증
        if (options) {
            this.validateOptions(options);
        }

        // 설정 적용
        if (options?.enabled !== undefined) {
            this.enabled = options.enabled;
        }

        // disable 전략 처리 (단순화)
        if (options?.enabled === false) {
            this.enabled = false;
        }

        if (options?.maxEvents) {
            // maxEvents 설정 적용 로직 (나중에 구현)
        }

        this.logger.info('PlaygroundHistoryPlugin created', {
            enabled: this.enabled,
            category: this.category,
            priority: this.priority
        });
    }

    // 🔧 옵션 검증 메서드
    private validateOptions(options: PlaygroundHistoryPluginOptions): void {
        if (options.maxEvents !== undefined) {
            if (typeof options.maxEvents !== 'number' || options.maxEvents < 1) {
                throw new Error(`PlaygroundHistoryPlugin: maxEvents must be a positive number. Got: ${options.maxEvents}`);
            }
            if (options.maxEvents > 10000) {
                throw new Error(`PlaygroundHistoryPlugin: maxEvents cannot exceed 10,000 for performance reasons. Got: ${options.maxEvents}`);
            }
        }
    }

    // ✅ 필수 추상 메서드 구현: initialize
    async initialize(options?: PlaygroundHistoryPluginOptions): Promise<void> {
        await super.initialize(options);
        this.logger.info('PlaygroundHistoryPlugin initialized');
    }

    // ✅ 필수 추상 메서드 구현: dispose
    async dispose(): Promise<void> {
        this.events = [];
        this.relationshipTracker.clear();
        this.agents = [];
        this.logger.info('PlaygroundHistoryPlugin disposed');
    }

    // ✅ 필수 추상 메서드 구현: getStats
    override getStats(): PlaygroundHistoryPluginStats {
        const eventCounts = {
            userMessages: 0,
            assistantResponses: 0,
            toolCalls: 0,
            toolResults: 0,
            errorEvents: 0
        };

        this.events.forEach(event => {
            switch (event.type) {
                case 'user_message':
                    eventCounts.userMessages++;
                    break;
                case 'assistant_response':
                    eventCounts.assistantResponses++;
                    break;
                case 'tool_call':
                    eventCounts.toolCalls++;
                    break;
                case 'tool_result':
                    eventCounts.toolResults++;
                    break;
                case 'error':
                    eventCounts.errorEvents++;
                    break;
            }
        });

        const maxExecutionLevel = this.events.reduce((max, event) =>
            Math.max(max, event.executionLevel), 0
        );

        return {
            enabled: this.enabled,
            calls: this.stats.calls,
            errors: this.stats.errors,
            lastActivity: this.stats.lastActivity,
            moduleEventsReceived: this.stats.moduleEventsReceived,
            totalEvents: this.events.length,
            ...eventCounts,
            totalAgents: this.agents.length,
            maxExecutionLevel
        };
    }

    // ✅ 필수 추상 메서드 구현: onModuleEvent
    async onModuleEvent(eventType: string, eventData: any): Promise<void> {
        try {
            this.stats.moduleEventsReceived++;
            this.stats.lastActivity = new Date();

            // SDK 이벤트를 ConversationEvent로 변환
            if (eventType.includes('execution.start')) {
                // 실행 시작 이벤트 처리
            } else if (eventType.includes('execution.complete')) {
                // 실행 완료 이벤트 처리
            } else if (eventType.includes('execution.error')) {
                // 실행 오류 이벤트 처리
            }
        } catch (error) {
            this.stats.errors++;
            this.logger.error('Failed to handle module event', { eventType, error });
        }
    }

    // �� 이벤트 기록 메서드 (안전성 강화 + ID 반환)
    recordEvent(event: Omit<ConversationEvent, 'id' | 'timestamp' | 'childEventIds' | 'executionLevel' | 'executionPath'>): string {
        if (!this.enabled) {
            return ''; // 플러그인이 비활성화된 경우 빈 ID 반환
        }

        try {
            const eventId = `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const parentEvent = event.parentEventId ? this.events.find(e => e.id === event.parentEventId) : undefined;

            // 부모-자식 관계 자동 설정
            if (event.parentEventId) {
                const parent = this.events.find(e => e.id === event.parentEventId);
                if (parent && Array.isArray(parent.childEventIds)) {
                    parent.childEventIds.push(eventId);
                }
            }

            // executionLevel 자동 계산 (null-safe)
            const executionLevel = this.calculateExecutionLevel(event.type, parentEvent?.executionLevel);

            // executionPath 자동 생성 (null-safe)
            const executionPath = this.buildExecutionPath(parentEvent?.executionPath, event.type, event);

            // 🔧 모든 필드에 기본값 보장
            const fullEvent: ConversationEvent = {
                // 기본 필드들
                id: eventId,
                type: event.type,
                timestamp: new Date(),
                content: event.content || '',

                // 계층 구조 필드들 (기본값 보장)
                parentEventId: event.parentEventId || undefined,
                childEventIds: [], // 항상 빈 배열로 초기화
                executionLevel: executionLevel || 0, // 기본값 0 (Team level)
                executionPath: executionPath || 'team', // 기본값 'team'

                // 컨텍스트 필드들 (안전한 기본값)
                agentId: event.agentId || undefined,
                toolName: event.toolName || undefined,
                delegationId: event.delegationId || undefined,
                parameters: event.parameters || undefined,
                result: event.result || undefined,
                error: event.error || undefined,
                metadata: event.metadata || undefined
            };

            this.events.push(fullEvent);

            // 🛡️ stats 안전성 보장
            if (this.stats && typeof this.stats.calls === 'number') {
                this.stats.calls++;
            }
            if (this.stats) {
                this.stats.lastActivity = new Date();
            }

            this.logger.debug('Event recorded', {
                eventId,
                type: event.type,
                executionLevel: fullEvent.executionLevel,
                executionPath: fullEvent.executionPath
            });

            return eventId; // ✅ 생성된 이벤트 ID 반환

        } catch (error) {
            // 🛡️ 에러 처리 안전성 보장
            if (this.stats && typeof this.stats.errors === 'number') {
                this.stats.errors++;
            }
            this.logger.error('Failed to record event', { error, eventType: event.type });
            return ''; // 오류 시 빈 ID 반환
        }
    }

    // 🔧 계층 계산 로직 (null-safe)
    private calculateExecutionLevel(eventType: BasicEventType, parentLevel?: number): number {
        try {
            // null/undefined 안전성 보장
            if (typeof parentLevel !== 'number') {
                return 0; // Team level (기본값)
            }

            if (eventType === 'tool_call' && parentLevel === 0) {
                return 1; // assignTask
            }
            if (parentLevel === 1) {
                return 2; // Sub-Agent level
            }
            if (eventType === 'tool_call' && parentLevel === 2) {
                return 3; // Sub-Tool
            }

            // 범위 제한 (최대 3레벨)
            return Math.min(Math.max(parentLevel, 0), 3);
        } catch (error) {
            this.logger.error('Failed to calculate execution level', { eventType, parentLevel, error });
            return 0; // 안전한 기본값
        }
    }

    // 🔧 실행 경로 생성 로직 (null-safe)
    private buildExecutionPath(parentPath?: string, eventType?: BasicEventType, context?: any): string {
        try {
            // null/undefined 안전성 보장
            if (!parentPath || typeof parentPath !== 'string') {
                return 'team'; // 기본 경로
            }

            if (eventType === 'tool_call' && context?.toolName === 'assignTask') {
                return `${parentPath}→assignTask`;
            }
            if (eventType === 'user_message' && parentPath.includes('assignTask')) {
                const agentId = context?.agentId || 'agent';
                return `${parentPath}→${agentId}`;
            }
            if (eventType === 'tool_call' && context?.toolName) {
                return `${parentPath}→${context.toolName}`;
            }

            // 기본적으로 부모 경로 유지
            return parentPath;
        } catch (error) {
            this.logger.error('Failed to build execution path', { parentPath, eventType, context, error });
            return 'team'; // 안전한 기본값
        }
    }

    // 🎯 시각화 데이터 조회 (안전성 강화)
    getVisualizationData(): VisualizationData {
        try {
            return {
                events: Array.isArray(this.events) ? [...this.events] : [], // 안전한 복사본
                mode: this.mode || 'agent', // 기본값 보장
                agents: Array.isArray(this.agents) ? [...this.agents] : [], // 안전한 복사본
                currentExecution: undefined // 필요시 구현
            };
        } catch (error) {
            this.logger.error('Failed to get visualization data', { error });
            // 🛡️ 실패 시 안전한 기본값 반환
            return {
                events: [],
                mode: 'agent',
                agents: [],
                currentExecution: undefined
            };
        }
    }

    // 🔧 유틸리티 메서드들
    setMode(mode: 'agent' | 'team'): void {
        this.mode = mode;
        this.logger.debug('Mode changed', { mode });
    }

    clearEvents(): void {
        this.events = [];
        this.relationshipTracker.clear();
        this.agents = [];
        this.logger.info('Events cleared');
    }

    getEventById(id: string): ConversationEvent | undefined {
        return this.events.find(event => event.id === id);
    }

    getEventsByType(type: BasicEventType): ConversationEvent[] {
        return this.events.filter(event => event.type === type);
    }

    getEventsByExecutionLevel(level: number): ConversationEvent[] {
        return this.events.filter(event => event.executionLevel === level);
    }
} 