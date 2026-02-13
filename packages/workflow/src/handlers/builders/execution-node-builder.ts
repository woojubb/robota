import type { IOwnerPathSegment } from '@robota-sdk/agents';
import type { IWorkflowNode } from '../../interfaces/workflow-node.js';
import { WORKFLOW_NODE_TYPES } from '../../constants/workflow-types.js';
import type { TEventData } from '../../interfaces/event-handler.js';

export class ExecutionNodeBuilder {
    createExecutionNode(eventData: TEventData): IWorkflowNode {
        const ownerPath: IOwnerPathSegment[] = eventData.context.ownerPath;
        const executionId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg?.type === 'execution' && typeof seg.id === 'string' && seg.id.length > 0) return seg.id;
            }
            return '';
        })();
        if (!executionId) {
            throw new Error('[PATH-ONLY] Missing execution segment in context.ownerPath for execution.start');
        }

        const level = ownerPath.length;
        return {
            id: executionId,
            type: WORKFLOW_NODE_TYPES.EXECUTION,
            level,
            status: 'running',
            timestamp: Date.now(),
            data: {
                sourceId: executionId,
                sourceType: 'execution',
                executionId,
                label: 'Execution',
                description: 'Execution lifecycle node',
                eventType: eventData.eventType,
                ...(eventData.parameters ? { parameters: eventData.parameters } : {}),
                ...(eventData.metadata ? { metadata: eventData.metadata } : {}),
                extensions: { robota: { originalEvent: eventData, handlerType: 'execution' } }
            },
            connections: []
        };
    }

    createToolResultNode(thinkingId: string, eventData: TEventData): IWorkflowNode {
        const nodeId = `tool_result_${thinkingId}`;
        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TOOL_RESULT,
            level: 2,
            status: 'running',
            timestamp: Date.now(),
            data: {
                sourceId: thinkingId,
                sourceType: 'execution',
                parentThinkingNodeId: thinkingId,
                label: 'Tool Result Aggregation',
                description: 'Aggregating tool call results',
                extensions: { robota: { originalEvent: eventData, handlerType: 'execution' } }
            },
            connections: []
        };
    }

    createExecutionErrorNode(data: TEventData): IWorkflowNode {
        const ownerPath: IOwnerPathSegment[] = data.context.ownerPath;
        const executionId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'execution' && seg.id.length > 0) return seg.id;
            }
            return '';
        })();
        if (!executionId) {
            throw new Error('[PATH-ONLY] Missing execution segment in context.ownerPath for execution.error');
        }
        const nodeId = `execution_error_${executionId}_${data.timestamp.getTime()}`;
        const errorMessage = (() => {
            if (data.error instanceof Error) return data.error.message;
            if (typeof data.error === 'string' && data.error.length > 0) return data.error;
            if (typeof (data.parameters as { error?: string } | undefined)?.error === 'string') {
                return (data.parameters as { error?: string }).error as string;
            }
            return '';
        })();
        if (!errorMessage) {
            throw new Error('[PATH-ONLY] Missing error details for execution.error');
        }
        const derivedLevel = ownerPath.length;
        const derivedParentId = ownerPath.length > 1 ? ownerPath[ownerPath.length - 2].id : undefined;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.ERROR,
            level: 0,
            status: 'error',
            timestamp: Date.now(),
            data: {
                sourceId: executionId,
                sourceType: 'execution',
                executionId,
                label: 'Execution Error',
                description: `Execution failed: ${errorMessage}`,
                eventType: data.eventType,
                ...(data.parameters ? { parameters: data.parameters } : {}),
                error: data.error ?? errorMessage,
                ...(data.metadata ? { metadata: data.metadata } : {}),
                executionInfo: {
                    executionId,
                    errorTime: new Date().toISOString(),
                    level: derivedLevel,
                    success: false
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        extra: { isExecutionError: true }
                    }
                }
            },
            ...(derivedParentId ? { parentId: derivedParentId } : {}),
            connections: []
        };
    }

    createUserMessageNode(data: TEventData): IWorkflowNode {
        const ownerPath: IOwnerPathSegment[] = data.context.ownerPath;
        if (!Array.isArray(ownerPath) || ownerPath.length === 0) {
            throw new Error('[PATH-ONLY] Missing context.ownerPath for execution.user_message');
        }
        const agentId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg?.type === 'agent' && typeof seg.id === 'string' && seg.id.length > 0) return seg.id;
            }
            return undefined;
        })();
        const executionId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg?.type === 'execution' && typeof seg.id === 'string' && seg.id.length > 0) return seg.id;
            }
            return undefined;
        })();
        if (!agentId || !executionId) {
            throw new Error('[PATH-ONLY] Missing agent/execution segments in context.ownerPath for execution.user_message');
        }
        const nodeId = `${agentId}_user_${executionId}_${data.timestamp.getTime()}`;
        const messageContent = (() => {
            const p = data.parameters;
            if (typeof (p as { input?: string }).input === 'string') return (p as { input?: string }).input as string;
            if (typeof (p as { userMessageContent?: string }).userMessageContent === 'string') return (p as { userMessageContent?: string }).userMessageContent as string;
            if (typeof (p as { content?: string }).content === 'string') return (p as { content?: string }).content as string;
            if (typeof (p as { message?: string }).message === 'string') return (p as { message?: string }).message as string;
            return '';
        })();
        if (!messageContent) {
            throw new Error('[PATH-ONLY] Missing message content for execution.user_message');
        }

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.USER_MESSAGE,
            level: 0,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: agentId,
                sourceType: 'user',
                executionId,
                label: 'User Message',
                description: 'User input message',
                eventType: data.eventType,
                ...(data.parameters ? { parameters: data.parameters } : {}),
                ...(data.metadata ? { metadata: data.metadata } : {}),
                messageInfo: {
                    messageId: nodeId,
                    content: messageContent,
                    length: messageContent.length,
                    timestamp: new Date().toISOString()
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        extra: { isUserMessage: true }
                    }
                }
            },
            connections: []
        };
    }

    createUserInputNode(data: TEventData): IWorkflowNode {
        const ownerPath: IOwnerPathSegment[] = data.context.ownerPath;
        const agentId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'agent' && seg.id.length > 0) return seg.id;
            }
            return '';
        })();
        const executionId = (() => {
            for (let i = ownerPath.length - 1; i >= 0; i--) {
                const seg = ownerPath[i];
                if (seg.type === 'execution' && seg.id.length > 0) return seg.id;
            }
            return '';
        })();
        if (!agentId || !executionId) {
            throw new Error('[PATH-ONLY] Missing agent/execution segments in context.ownerPath for user.input');
        }
        const nodeId = `user_input_${agentId}_${executionId}_${data.timestamp.getTime()}`;
        const inputContent = (() => {
            if (typeof (data.parameters as { input?: string } | undefined)?.input === 'string') {
                return (data.parameters as { input?: string }).input as string;
            }
            if (typeof (data.parameters as { content?: string } | undefined)?.content === 'string') {
                return (data.parameters as { content?: string }).content as string;
            }
            return '';
        })();
        if (!inputContent) {
            throw new Error('[PATH-ONLY] Missing input content for user.input');
        }
        const derivedParentId = ownerPath.length > 1 ? ownerPath[ownerPath.length - 2].id : undefined;
        const inputType = (data.parameters as { inputType?: string } | undefined)?.inputType;

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.USER_MESSAGE,
            level: 0,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: agentId,
                sourceType: 'user',
                executionId,
                label: 'User Input',
                description: 'User provided input',
                eventType: data.eventType,
                ...(data.parameters ? { parameters: data.parameters } : {}),
                ...(data.metadata ? { metadata: data.metadata } : {}),
                inputInfo: {
                    inputId: nodeId,
                    content: inputContent,
                    ...(typeof inputType === 'string' ? { inputType } : {}),
                    timestamp: new Date().toISOString()
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'execution',
                        extra: { isUserInput: true }
                    }
                }
            },
            ...(derivedParentId ? { parentId: derivedParentId } : {}),
            connections: []
        };
    }
}
