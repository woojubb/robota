/**
 * ExternalWorkflowStore - external injection surface for the workflow store
 *
 * Purpose: allow manual node/edge injection without modifying the core SDK store.
 */

import type { IUniversalWorkflowEdge, IUniversalWorkflowNode } from '@robota-sdk/workflow';
import { SilentLogger, type SimpleLogger } from '@robota-sdk/agents';

/**
 * External workflow store interface.
 * Provides a minimal API for adding manual nodes/edges into the store.
 */
export interface IExternalWorkflowStore {
    // Node management
    addNode(node: IUniversalWorkflowNode): void;
    getNodes(): IUniversalWorkflowNode[];

    // Edge management
    addEdge(edge: IUniversalWorkflowEdge): void;
    getEdges(): IUniversalWorkflowEdge[];

    // Manual node helpers
    addAgentNode(agentData: { id: string; name: string; level?: number; taskName?: string }): void;
    addUserInputNode(inputData: { id: string; content: string }): void;

    // Lifecycle
    clear(): void;

    // Update callback
    setUpdateCallback(callback: () => Promise<void>): void;
}

export interface IManualAgentData {
    id: string;
    name: string;
    level?: number;
    taskName?: string;
}

export interface ManualUserInputData {
    id: string;
    content: string;
}

/**
 * Default external workflow store implementation.
 * Stores injected nodes/edges using universal workflow shapes.
 */
export class DefaultExternalWorkflowStore implements IExternalWorkflowStore {
    private nodes: IUniversalWorkflowNode[] = [];
    private edges: IUniversalWorkflowEdge[] = [];
    private logger: SimpleLogger;
    private updateCallback: (() => Promise<void>) | null = null;

    constructor(logger?: SimpleLogger) {
        this.logger = logger || SilentLogger;
        this.logger.debug('DefaultExternalWorkflowStore initialized');
    }

    /**
     * 노드 추가 (범용)
     */
    addNode(node: IUniversalWorkflowNode): void {
        this.nodes.push(node);
        this.logger.debug(`Added node: ${node.id} (type: ${node.type})`);

        // Trigger store update after node insertion.
        this.triggerUpdate();
    }

    /**
     * 모든 노드 반환
     */
    getNodes(): IUniversalWorkflowNode[] {
        return [...this.nodes];
    }

    /**
     * 엣지 추가 (범용)
     */
    addEdge(edge: IUniversalWorkflowEdge): void {
        this.edges.push(edge);
        this.logger.debug(`Added edge: ${edge.id} (${edge.source} → ${edge.target})`);

        // Trigger store update after edge insertion.
        this.triggerUpdate();
    }

    /**
     * 모든 엣지 반환
     */
    getEdges(): IUniversalWorkflowEdge[] {
        return [...this.edges];
    }

    /**
     * Agent 노드 추가 헬퍼
     */
    addAgentNode(agentData: IManualAgentData): void {
        const now = Date.now();
        const agentNode: IUniversalWorkflowNode = {
            id: agentData.id,
            type: 'agent',
            level: agentData.level || 1,
            status: 'pending',
            timestamp: now,
            connections: [],
            position: {
                x: 150 + (agentData.level || 1) * 200,
                y: 200,
                level: agentData.level || 1,
                order: 0
            },
            data: {
                label: agentData.name || 'Agent',
                description: agentData.taskName ?? '',
                tools: ['assignTask']
            },
            visualState: {
                status: 'pending',
                emphasis: 'normal',
                lastUpdated: new Date()
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        this.addNode(agentNode);
        this.logger.info(`Agent node added: ${agentData.name} (${agentData.id})`);
    }

    /**
     * ❌ User Input 노드 추가 비활성화 - 이벤트 시스템이 자동으로 노드 생성
     */
    addUserInputNode(inputData: ManualUserInputData): void {
        this.logger.debug('User Input node creation disabled - event system will handle');
        // 인위적 노드 생성 제거됨
    }

    /**
     * 모든 노드와 엣지 초기화
     */
    clear(): void {
        this.nodes = [];
        this.edges = [];
        this.logger.debug('External workflow store cleared');
    }

    /**
     * 업데이트 콜백 설정 (SDK Store 트리거용)
     */
    setUpdateCallback(callback: () => Promise<void>): void {
        this.updateCallback = callback;
        this.logger.debug('Update callback set for SDK Store trigger');
    }

    /**
     * SDK Store 업데이트 트리거 (비동기)
     */
    private triggerUpdate(): void {
        if (this.updateCallback) {
            this.updateCallback().catch(error => {
                this.logger.error('Error triggering SDK Store update:', error);
            });
        }
    }
}