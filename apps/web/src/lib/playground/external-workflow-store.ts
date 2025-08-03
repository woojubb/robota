/**
 * ExternalWorkflowStore - SDK Store 외부 주입을 위한 인터페이스
 * 
 * Purpose: RealTimeWorkflowBuilder에 외부에서 Manual 노드를 주입할 수 있도록 하는 최소 인터페이스
 * Architecture: 기존 SDK 로직 수정 없이 외부 접근만 가능하게 하는 최소 수정 방식
 */

import type { UniversalWorkflowStructure, UniversalWorkflowNode, UniversalWorkflowEdge } from '@robota-sdk/agents';
import { SilentLogger, type SimpleLogger } from '@robota-sdk/agents';

/**
 * 외부 워크플로우 스토어 인터페이스
 * SDK Store에 외부에서 Manual 노드를 추가할 수 있는 최소 기능 제공
 */
export interface ExternalWorkflowStore {
    // 기본 노드 관리
    addNode(node: UniversalWorkflowNode): void;
    getNodes(): UniversalWorkflowNode[];

    // 기본 엣지 관리
    addEdge(edge: UniversalWorkflowEdge): void;
    getEdges(): UniversalWorkflowEdge[];

    // Manual 노드 추가용 헬퍼 메서드들
    addTeamNode(teamData: { id: string; name: string }): void;
    addAgentNode(agentData: { id: string; name: string; level?: number; taskName?: string }): void;
    addUserInputNode(inputData: { id: string; content: string }): void;

    // 초기화 및 정리
    clear(): void;

    // 업데이트 트리거 콜백 설정
    setUpdateCallback(callback: () => Promise<void>): void;
}

/**
 * Manual 노드 생성을 위한 기본 데이터 타입들
 */
export interface ManualTeamData {
    id: string;
    name: string;
}

export interface ManualAgentData {
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
 * 기본 ExternalWorkflowStore 구현체
 * Manual 노드들을 UniversalWorkflowNode 형태로 변환하여 저장
 */
export class DefaultExternalWorkflowStore implements ExternalWorkflowStore {
    private nodes: UniversalWorkflowNode[] = [];
    private edges: UniversalWorkflowEdge[] = [];
    private logger: SimpleLogger;
    private updateCallback: (() => Promise<void>) | null = null;

    constructor(logger?: SimpleLogger) {
        this.logger = logger || SilentLogger;
        this.logger.debug('DefaultExternalWorkflowStore initialized');
    }

    /**
     * 노드 추가 (범용)
     */
    addNode(node: UniversalWorkflowNode): void {
        // 중복 방지
        const existingIndex = this.nodes.findIndex(n => n.id === node.id);
        if (existingIndex !== -1) {
            this.nodes[existingIndex] = node;
            this.logger.debug(`Updated existing node: ${node.id}`);
        } else {
            this.nodes.push(node);
            this.logger.debug(`Added new node: ${node.id} (type: ${node.type})`);
        }

        // 노드 추가 후 SDK Store 업데이트 트리거
        this.triggerUpdate();
    }

    /**
     * 모든 노드 반환
     */
    getNodes(): UniversalWorkflowNode[] {
        return [...this.nodes]; // 복사본 반환
    }

    /**
     * 엣지 추가 (범용)
     */
    addEdge(edge: UniversalWorkflowEdge): void {
        // 중복 방지
        const existingIndex = this.edges.findIndex(e => e.id === edge.id);
        if (existingIndex !== -1) {
            this.edges[existingIndex] = edge;
            this.logger.debug(`Updated existing edge: ${edge.id}`);
        } else {
            this.edges.push(edge);
            this.logger.debug(`Added new edge: ${edge.id} (${edge.source} → ${edge.target})`);
        }

        // 엣지 추가 후 SDK Store 업데이트 트리거
        this.triggerUpdate();
    }

    /**
     * 모든 엣지 반환
     */
    getEdges(): UniversalWorkflowEdge[] {
        return [...this.edges]; // 복사본 반환
    }

    /**
     * Team 노드 추가 헬퍼
     */
    addTeamNode(teamData: ManualTeamData): void {
        const teamNode: UniversalWorkflowNode = {
            id: teamData.id,
            type: 'team',
            level: 0,
            position: { x: 250, y: 50, level: 0, order: 0 },
            data: {
                label: teamData.name || 'Team'
            },
            visualState: {
                status: 'pending',
                emphasis: 'normal',
                lastUpdated: new Date()
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        this.addNode(teamNode);
        this.logger.info(`Team node added: ${teamData.name} (${teamData.id})`);
    }

    /**
     * Agent 노드 추가 헬퍼
     */
    addAgentNode(agentData: ManualAgentData): void {
        const agentNode: UniversalWorkflowNode = {
            id: agentData.id,
            type: 'agent',
            level: agentData.level || 1,
            position: {
                x: 150 + (agentData.level || 1) * 200,
                y: 200,
                level: agentData.level || 1,
                order: 0
            },
            data: {
                label: agentData.name || 'Agent',
                taskName: agentData.taskName,
                toolSlots: ['assignTask'] // 기본 도구 슬롯
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
     * User Input 노드 추가 헬퍼
     */
    addUserInputNode(inputData: ManualUserInputData): void {
        const userInputNode: UniversalWorkflowNode = {
            id: inputData.id,
            type: 'user_input',
            level: 0,
            position: { x: 100, y: 350, level: 0, order: 1 },
            data: {
                label: 'User Input',
                content: inputData.content
            },
            visualState: {
                status: 'completed',
                emphasis: 'normal',
                lastUpdated: new Date()
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        this.addNode(userInputNode);
        this.logger.info(`User Input node added: ${inputData.content.substring(0, 50)}...`);
    }

    /**
     * 모든 노드와 엣지 초기화
     */
    clear(): void {
        this.nodes = [];
        this.edges = [];
        this.logger.debug('ExternalWorkflowStore cleared');
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