import type { IWorkflowNode } from '../../interfaces/workflow-node.js';
import { WORKFLOW_NODE_TYPES, type TWorkflowNodeKind } from '../../constants/workflow-types.js';
import type { TEventData } from '../../interfaces/event-handler.js';
import type { IPathInfo } from '../path-info.js';

export class ToolNodeBuilder {
    createToolCallNode(data: TEventData, pathInfo: IPathInfo): IWorkflowNode {
        const toolCallId = pathInfo.nodeId;
        const nodeId = toolCallId;

        const toolName = this.getToolName(data);
        const toolType = this.getToolTypeFromName(toolName);

        return {
            id: nodeId,
            type: toolType,
            level: 2,
            status: 'running',
            timestamp: Date.now(),
            data: {
                sourceId: toolCallId,
                sourceType: 'tool',
                executionId: toolCallId,
                toolName: toolName,
                label: `${toolName} Call`,
                description: `Tool call: ${toolName}`,
                eventType: data.eventType,
                ...(data.parameters ? { parameters: data.parameters } : {}),
                ...(data.metadata ? { metadata: data.metadata } : {}),
                toolCall: undefined,
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'tool',
                        extra: {
                            toolName: toolName
                        }
                    }
                }
            },
            connections: []
        };
    }

    createToolCallErrorNode(data: TEventData, pathInfo: IPathInfo): IWorkflowNode {
        const toolCallId = pathInfo.nodeId;
        const nodeId = `tool_call_error_${toolCallId}`;

        const toolName = this.getToolName(data);
        const errorMessage = this.getErrorMessage(data);

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.ERROR,
            level: 2,
            status: 'error',
            timestamp: Date.now(),
            data: {
                sourceId: toolCallId,
                sourceType: 'tool',
                executionId: toolCallId,
                toolName: toolName,
                label: `${toolName} Error`,
                description: `Tool call error: ${errorMessage}`,
                eventType: data.eventType,
                ...(data.parameters ? { parameters: data.parameters } : {}),
                error: data.error ?? errorMessage,
                ...(data.metadata ? { metadata: data.metadata } : {}),
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'tool',
                        extra: {
                            toolName: toolName,
                            isError: true
                        }
                    }
                }
            },
            connections: []
        };
    }

    createToolResponseNode(data: TEventData, pathInfo: IPathInfo): IWorkflowNode {
        const toolCallId = pathInfo.nodeId;
        if (!toolCallId) {
            throw new Error('[PATH-ONLY] Missing tool call id (path tail) for tool.call_response_ready');
        }
        const nodeId = `tool_response_call_${toolCallId}`;

        const toolName = this.getToolName(data);
        const result = data.result;
        if (!result || typeof result !== 'object') {
            throw new Error('[PATH-ONLY] Missing tool result object for tool.call_response_ready');
        }
        const responseContent = this.getResponseContent(result);

        return {
            id: nodeId,
            type: WORKFLOW_NODE_TYPES.TOOL_RESPONSE,
            level: 2,
            status: 'completed',
            timestamp: Date.now(),
            data: {
                sourceId: toolCallId,
                sourceType: 'tool',
                executionId: toolCallId,
                toolName: toolName,
                label: `${toolName} Response`,
                description: `Tool response from ${toolName}`,
                eventType: data.eventType,
                ...(data.parameters ? { parameters: data.parameters } : {}),
                result: result,
                ...(data.metadata ? { metadata: data.metadata } : {}),
                toolResponse: {
                    toolName: toolName,
                    content: responseContent,
                    success: !data.error,
                    timestamp: new Date().toISOString()
                },
                responseMetrics: {
                    responseLength: String(responseContent).length,
                    contentType: typeof responseContent,
                    hasError: !!data.error
                },
                extensions: {
                    robota: {
                        originalEvent: data,
                        handlerType: 'tool',
                        extra: {
                            toolName: toolName,
                            toolCallId: toolCallId
                        }
                    }
                }
            },
            connections: []
        };
    }

    private getToolTypeFromName(toolName: string): TWorkflowNodeKind {
        const toolTypeMap: Record<string, TWorkflowNodeKind> = {
            'assignTask': WORKFLOW_NODE_TYPES.TOOL_CALL,
            'fileRead': WORKFLOW_NODE_TYPES.TOOL_CALL,
            'fileWrite': WORKFLOW_NODE_TYPES.TOOL_CALL,
            'webSearch': WORKFLOW_NODE_TYPES.TOOL_CALL,
            'codeExecution': WORKFLOW_NODE_TYPES.TOOL_CALL,
            'apiCall': WORKFLOW_NODE_TYPES.TOOL_CALL,
            'dataProcessing': WORKFLOW_NODE_TYPES.TOOL_CALL
        };

        return toolTypeMap[toolName] || WORKFLOW_NODE_TYPES.TOOL_CALL;
    }

    private getToolName(data: TEventData): string {
        const directName = (data as { toolName?: unknown }).toolName;
        if (typeof directName === 'string' && directName.length > 0) return directName;
        if (typeof data.parameters?.toolName === 'string' && data.parameters.toolName.length > 0) return data.parameters.toolName;
        if (typeof data.parameters?.name === 'string' && data.parameters.name.length > 0) return data.parameters.name;
        const resultName = (data.result && typeof data.result === 'object' && 'toolName' in data.result)
            ? (data.result as { toolName?: unknown }).toolName
            : undefined;
        if (typeof resultName === 'string' && resultName.length > 0) return resultName;
        throw new Error('[PATH-ONLY] Missing toolName for tool event');
    }

    private getErrorMessage(data: TEventData): string {
        if (data.error instanceof Error) return data.error.message;
        if (typeof data.error === 'string' && data.error.length > 0) return data.error;
        const paramError = (data.parameters as { error?: unknown } | undefined)?.error;
        if (typeof paramError === 'string' && paramError.length > 0) return paramError;
        throw new Error('[PATH-ONLY] Missing error details for tool.call_error');
    }

    private getResponseContent(result: object): string {
        if ('content' in result && typeof (result as { content?: unknown }).content === 'string') {
            return (result as { content?: string }).content as string;
        }
        if ('output' in result && typeof (result as { output?: unknown }).output === 'string') {
            return (result as { output?: string }).output as string;
        }
        if ('response' in result && typeof (result as { response?: unknown }).response === 'string') {
            return (result as { response?: string }).response as string;
        }
        throw new Error('[PATH-ONLY] Missing response content for tool.call_response_ready');
    }
}
