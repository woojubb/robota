import type { ILogger } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
import type { IWorkflowNode } from '../../interfaces/workflow-node.js';
import { WORKFLOW_NODE_TYPES } from '../../constants/workflow-types.js';
import type { TEventData } from '../../interfaces/event-handler.js';
import type { IPathInfo } from '../path-info.js';

export class AgentNodeBuilder {
    private agentNumberMap = new Map<string, number>();
    private agentCopyCounters = new Map<number, number>();
    private logger: ILogger;

    constructor(logger: ILogger = SilentLogger) {
        this.logger = logger;
    }

    createAgentNode(eventData: TEventData, sourceId: string, pathInfo: IPathInfo): IWorkflowNode {
        const agentKey = sourceId;
        const agentNumber = this.assignAgentNumber(agentKey);
        const copyNumber = this.getNextCopyNumber(agentNumber);
        const agentId = sourceId;

        return {
            id: agentId,
            type: WORKFLOW_NODE_TYPES.AGENT,
            level: pathInfo.segments.length,
            status: 'running',
            timestamp: Date.now(),
            data: {
                eventType: eventData.eventType,
                sourceId: agentKey,
                sourceType: 'agent',
                agentNumber: agentNumber,
                copyNumber: copyNumber,
                label: `Agent ${agentNumber}`,
                description: 'AI Agent instance',
                ...(Array.isArray(eventData?.parameters?.tools) && eventData.parameters.tools.length > 0
                    ? { tools: [...eventData.parameters.tools] as string[] }
                    : {}),
                originalEventTimestamp: eventData.timestamp,
                reservedThinkingId: `thinking_${agentId}`,
                extensions: {
                    robota: {
                        originalEvent: eventData,
                        handlerType: 'agent',
                        extra: {
                            ownerPath: pathInfo.segments,
                            agentNumber: agentNumber
                        }
                    }
                }
            },
            connections: []
        };
    }

    createThinkingNode(data: TEventData, pathInfo: IPathInfo, forcedTimestamp?: number): IWorkflowNode {
        const agentKey = typeof data.sourceId === 'string' ? data.sourceId : '';
        const agentNumber = this.agentNumberMap.get(agentKey) || 0;
        const sourceId = agentKey.length > 0 ? agentKey : undefined;
        const thinkingId = pathInfo.nodeId;

        return {
            id: thinkingId,
            type: WORKFLOW_NODE_TYPES.AGENT_THINKING,
            level: pathInfo.segments.length,
            status: 'running',
            timestamp: typeof forcedTimestamp === 'number' ? forcedTimestamp : Date.now(),
            data: {
                eventType: data.eventType,
                sourceId: sourceId,
                sourceType: 'agent',
                agentNumber: agentNumber,
                label: `Agent ${agentNumber} Thinking`,
                description: 'Agent processing and reasoning',
                originalEventTimestamp: data.timestamp,
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'agent',
                        extra: {
                            ownerPath: pathInfo.segments,
                            agentNumber: agentNumber
                        }
                    }
                }
            },
            connections: []
        };
    }

    createResponseNode(data: TEventData, pathInfo: IPathInfo): IWorkflowNode {
        const agentKey = typeof data.sourceId === 'string' ? data.sourceId : '';
        const agentNumber = this.agentNumberMap.get(agentKey) || 0;
        const sourceId = agentKey.length > 0 ? agentKey : undefined;
        const responseId = pathInfo.nodeId;
        const responseContent = (() => {
            const content = (data as { content?: unknown }).content;
            if (typeof content === 'string' && content.length > 0) return content;
            const message = (data as { message?: unknown }).message;
            if (typeof message === 'string' && message.length > 0) return message;
            return '';
        })();
        if (!responseContent) {
            throw new Error('[PATH-ONLY] Missing response content for execution.assistant_message_complete');
        }

        return {
            id: responseId,
            type: WORKFLOW_NODE_TYPES.RESPONSE,
            level: pathInfo.segments.length,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                eventType: data.eventType,
                sourceId: sourceId,
                sourceType: 'agent',
                agentNumber: agentNumber,
                label: `Agent ${agentNumber} Response`,
                description: 'Agent response and output',
                response: responseContent,
                originalEventTimestamp: data.timestamp,
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'agent',
                        extra: {
                            ownerPath: pathInfo.segments,
                            agentNumber: agentNumber
                        }
                    }
                }
            },
            connections: []
        };
    }

    getAgentNumber(sourceId: string): number | undefined {
        return this.agentNumberMap.get(sourceId);
    }

    getAllAgentMappings(): {
        agentNumbers: Map<string, number>;
    } {
        return {
            agentNumbers: new Map(this.agentNumberMap),
        };
    }

    clear(): void {
        this.agentNumberMap.clear();
        this.agentCopyCounters.clear();
    }

    private assignAgentNumber(sourceId: string): number {
        const existing = this.agentNumberMap.get(sourceId);
        if (existing !== undefined) {
            return existing;
        }

        const usedNumbers = new Set(this.agentNumberMap.values());
        let agentNumber = 0;
        while (usedNumbers.has(agentNumber)) {
            agentNumber++;
        }

        this.agentNumberMap.set(sourceId, agentNumber);
        this.logger.debug(`🔢 [AGENT-NUMBER] Assigned agent number ${agentNumber} to ${sourceId}`);

        return agentNumber;
    }

    private getNextCopyNumber(agentNumber: number): number {
        const current = this.agentCopyCounters.get(agentNumber) ?? 0;
        const next = current + 1;
        this.agentCopyCounters.set(agentNumber, next);
        return next;
    }
}
