/**
 * EventServiceHookFactory - Bridge between EventService and ToolHooks
 * 
 * Converts EventService to ToolHooks interface for backward compatibility
 * and seamless integration with existing tool execution system.
 * 
 * Architectural Benefits:
 * - Single event system: All events flow through EventService
 * - Backward compatibility: Existing toolHooks consumers work unchanged
 * - Hierarchical tracking: Leverages ToolExecutionContext for complete tracking
 * - Clean separation: EventService handles emission, ToolHooks handle execution lifecycle
 */

import { EventService, ServiceEventType, ServiceEventData } from '../services/event-service';
import { ToolHooks } from '../abstracts/base-tool';
import { ToolExecutionContext } from '../interfaces/tool';

/**
 * Factory class to create ToolHooks from EventService
 * Provides static methods for creating hooks that emit events through EventService
 */
export class EventServiceHookFactory {
    /**
     * Create ToolHooks that emit events through the provided EventService
     * 
     * @param eventService - EventService instance to emit events through
     * @param sourceId - Source identifier (agent ID, team ID, etc.)
     * @returns ToolHooks that emit events through EventService
     */
    static createToolHooks(eventService: EventService, sourceId: string): ToolHooks {
        return {
            /**
             * Emit tool_call_start event before tool execution
             */
            beforeExecute: async (toolName: string, parameters: any, context?: ToolExecutionContext) => {
                // Determine if this is a subtool (called from within an agent) or main tool
                const isSubTool = context?.executionLevel && context.executionLevel > 1;
                const eventType = isSubTool ? 'subtool.call_start' : 'tool_call_start';

                // 🔑 Use actual executionId as sourceId for proper hierarchy mapping
                const actualSourceId = context?.executionId || sourceId;

                const eventData: ServiceEventData = {
                    sourceType: 'tool',
                    sourceId: actualSourceId,
                    toolName,
                    parameters,

                    // Include the actual tool execution ID for hierarchy tracking
                    executionId: context?.executionId,

                    // Extract hierarchical information from ToolExecutionContext
                    parentExecutionId: context?.parentExecutionId,
                    rootExecutionId: context?.rootExecutionId,
                    executionLevel: context?.executionLevel,
                    executionPath: context?.executionPath,

                    // Include real-time data if available
                    timestamp: context?.realTimeData?.startTime || new Date(),
                    metadata: {
                        toolName,
                        phase: 'start',
                        isSubTool: isSubTool,
                        executionId: context?.executionId, // Also include in metadata for backup
                        context: context ? {
                            userId: context.userId,
                            sessionId: context.sessionId,
                            metadata: context.metadata
                        } : undefined
                    }
                };

                eventService.emit(eventType, eventData);
            },

            /**
             * Emit tool_call_complete event after successful tool execution
             */
            afterExecute: async (toolName: string, parameters: any, result: any, context?: ToolExecutionContext) => {
                // Determine if this is a subtool (called from within an agent) or main tool
                const isSubTool = context?.executionLevel && context.executionLevel > 1;
                const eventType = isSubTool ? 'subtool.call_complete' : 'tool_call_complete';

                // 🔑 Use actual executionId as sourceId for proper hierarchy mapping
                const actualSourceId = context?.executionId || sourceId;

                const eventData: ServiceEventData = {
                    sourceType: 'tool',
                    sourceId: actualSourceId,
                    toolName,
                    parameters,
                    result,

                    // Include the actual tool execution ID for hierarchy tracking
                    executionId: context?.executionId,

                    // Extract hierarchical information from ToolExecutionContext
                    parentExecutionId: context?.parentExecutionId,
                    rootExecutionId: context?.rootExecutionId,
                    executionLevel: context?.executionLevel,
                    executionPath: context?.executionPath,

                    // Include execution completion time
                    timestamp: new Date(),
                    metadata: {
                        toolName,
                        phase: 'complete',
                        resultType: typeof result,
                        isSubTool: isSubTool,
                        executionId: context?.executionId, // Also include in metadata for backup
                        context: context ? {
                            userId: context.userId,
                            sessionId: context.sessionId,
                            metadata: context.metadata
                        } : undefined
                    }
                };

                eventService.emit(eventType, eventData);
            },

            /**
             * Emit tool_call_error event when tool execution fails
             */
            onError: async (toolName: string, parameters: any, error: Error, context?: ToolExecutionContext) => {
                // Determine if this is a subtool (called from within an agent) or main tool
                const isSubTool = context?.executionLevel && context.executionLevel > 1;
                const eventType = isSubTool ? 'subtool.call_error' : 'tool_call_error';

                // 🔑 Use actual executionId as sourceId for proper hierarchy mapping
                const actualSourceId = context?.executionId || sourceId;

                const eventData: ServiceEventData = {
                    sourceType: 'tool',
                    sourceId: actualSourceId,
                    toolName,
                    parameters,
                    error: error.message,

                    // Include the actual tool execution ID for hierarchy tracking
                    executionId: context?.executionId,

                    // Extract hierarchical information from ToolExecutionContext
                    parentExecutionId: context?.parentExecutionId,
                    rootExecutionId: context?.rootExecutionId,
                    executionLevel: context?.executionLevel,
                    executionPath: context?.executionPath,

                    // Include error timestamp
                    timestamp: new Date(),
                    metadata: {
                        toolName,
                        phase: 'error',
                        errorMessage: error.message,
                        errorStack: error.stack,
                        isSubTool: isSubTool,
                        executionId: context?.executionId, // Also include in metadata for backup
                        context: context ? {
                            userId: context.userId,
                            sessionId: context.sessionId,
                            metadata: context.metadata
                        } : undefined
                    }
                };

                eventService.emit(eventType, eventData);
            }
        };
    }

    /**
     * Create agent-specific ToolHooks for agent tool calls
     * 
     * @param eventService - EventService instance to emit events through
     * @param agentId - Agent identifier
     * @param agentName - Agent name for better tracking
     * @returns ToolHooks configured for agent context
     */
    static createAgentToolHooks(eventService: EventService, agentId: string, agentName?: string): ToolHooks {
        const hooks = this.createToolHooks(eventService, agentId);

        // Wrap hooks to add agent context to metadata
        return {
            beforeExecute: async (toolName: string, parameters: any, context?: ToolExecutionContext) => {
                // Add agent context to the execution context
                const enhancedContext: ToolExecutionContext = {
                    ...context,
                    toolName,
                    parameters,
                    metadata: {
                        ...context?.metadata,
                        agentId,
                        agentName: agentName || agentId,
                        executionType: 'agent_tool_call'
                    }
                };

                if (hooks.beforeExecute) {
                    await hooks.beforeExecute(toolName, parameters, enhancedContext);
                }
            },

            afterExecute: async (toolName: string, parameters: any, result: any, context?: ToolExecutionContext) => {
                // Add agent context to the execution context
                const enhancedContext: ToolExecutionContext = {
                    ...context,
                    toolName,
                    parameters,
                    metadata: {
                        ...context?.metadata,
                        agentId,
                        agentName: agentName || agentId,
                        executionType: 'agent_tool_call'
                    }
                };

                if (hooks.afterExecute) {
                    await hooks.afterExecute(toolName, parameters, result, enhancedContext);
                }
            },

            onError: async (toolName: string, parameters: any, error: Error, context?: ToolExecutionContext) => {
                // Add agent context to the execution context
                const enhancedContext: ToolExecutionContext = {
                    ...context,
                    toolName,
                    parameters,
                    metadata: {
                        ...context?.metadata,
                        agentId,
                        agentName: agentName || agentId,
                        executionType: 'agent_tool_call'
                    }
                };

                if (hooks.onError) {
                    await hooks.onError(toolName, parameters, error, enhancedContext);
                }
            }
        };
    }

    /**
     * Create team-specific ToolHooks for team task delegation
     * 
     * @param eventService - EventService instance to emit events through
     * @param teamId - Team identifier
     * @param teamName - Team name for better tracking
     * @returns ToolHooks configured for team context
     */
    static createTeamToolHooks(eventService: EventService, teamId: string, teamName?: string): ToolHooks {
        const hooks = this.createToolHooks(eventService, teamId);

        // Wrap hooks to add team context to metadata
        return {
            beforeExecute: async (toolName: string, parameters: any, context?: ToolExecutionContext) => {
                // Add team context to the execution context
                const enhancedContext: ToolExecutionContext = {
                    ...context,
                    toolName,
                    parameters,
                    metadata: {
                        ...context?.metadata,
                        teamId,
                        teamName: teamName || teamId,
                        executionType: 'team_task_delegation'
                    }
                };

                if (hooks.beforeExecute) {
                    await hooks.beforeExecute(toolName, parameters, enhancedContext);
                }
            },

            afterExecute: async (toolName: string, parameters: any, result: any, context?: ToolExecutionContext) => {
                // Add team context to the execution context
                const enhancedContext: ToolExecutionContext = {
                    ...context,
                    toolName,
                    parameters,
                    metadata: {
                        ...context?.metadata,
                        teamId,
                        teamName: teamName || teamId,
                        executionType: 'team_task_delegation'
                    }
                };

                if (hooks.afterExecute) {
                    await hooks.afterExecute(toolName, parameters, result, enhancedContext);
                }
            },

            onError: async (toolName: string, parameters: any, error: Error, context?: ToolExecutionContext) => {
                // Add team context to the execution context
                const enhancedContext: ToolExecutionContext = {
                    ...context,
                    toolName,
                    parameters,
                    metadata: {
                        ...context?.metadata,
                        teamId,
                        teamName: teamName || teamId,
                        executionType: 'team_task_delegation'
                    }
                };

                if (hooks.onError) {
                    await hooks.onError(toolName, parameters, error, enhancedContext);
                }
            }
        };
    }
} 