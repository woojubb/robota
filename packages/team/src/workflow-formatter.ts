import type { WorkflowHistory, AgentTreeNode, AgentConversationData } from './team-container';

/**
 * Workflow History Formatting Utilities
 * 
 * This module provides utility functions to convert workflow history data
 * into various formats for analysis and visualization.
 */

/**
 * Generate a text-based flowchart of the team workflow
 * 
 * @param workflowHistory - Complete workflow history
 * @returns Text representation of the workflow flowchart
 * 
 * @example
 * ```ts
 * import { generateWorkflowFlowchart } from '@robota-sdk/team/workflow-formatter';
 * 
 * const history = team.getWorkflowHistory();
 * if (history) {
 *   const flowchart = generateWorkflowFlowchart(history);
 *   console.log(flowchart);
 * }
 * ```
 */
export function generateWorkflowFlowchart(workflowHistory: WorkflowHistory): string {
    const lines: string[] = [];

    // Header
    lines.push('');
    lines.push('📊 Team Workflow Summary');
    lines.push('═'.repeat(50));
    lines.push('');

    // Execution Overview
    lines.push('🚀 Execution Overview');
    lines.push(`   📋 Request: ${truncateText(workflowHistory.userRequest, 80)}`);
    if (workflowHistory.endTime) {
        const duration = workflowHistory.endTime.getTime() - workflowHistory.startTime.getTime();
        lines.push(`   ⏱️  Duration: ${formatDuration(duration)} | Status: ${workflowHistory.success ? '✅ Success' : '❌ Failed'}`);
    }
    lines.push('');

    // Task Distribution with Agent Performance
    lines.push('🔗 Task Distribution & Agent Performance');
    lines.push('');

    // Show user request as root
    lines.push('└─ 👤 User Request');
    lines.push(`   └─ 📝 ${truncateText(workflowHistory.userRequest, 70)}`);
    lines.push('');

    // Show delegated tasks with performance info
    const taskAgents = workflowHistory.agentConversations.filter(agent => agent.parentAgentId);
    const coordinator = workflowHistory.agentConversations.find(agent => !agent.parentAgentId);

    if (taskAgents.length > 0) {
        lines.push('   └─ 🤖 Team Coordination & Delegation');

        // Show coordinator performance
        if (coordinator) {
            let coordinatorInfo = `👑 Coordinator: ${coordinator.messages.length} messages`;

            // Add provider/model info for coordinator
            if (coordinator.aiProvider && coordinator.aiModel) {
                coordinatorInfo += ` [${coordinator.aiProvider}/${coordinator.aiModel}]`;
            }

            lines.push(`      ${coordinatorInfo}`);
        }

        lines.push('');

        taskAgents.forEach((agent, index) => {
            const isLast = index === taskAgents.length - 1;
            const connector = isLast ? '└─' : '├─';



            // Build agent info with provider, model, and template
            let agentInfo = `🎯 ${agent.agentId} (${agent.messages.length} msgs)`;

            // Add provider/model info
            if (agent.aiProvider && agent.aiModel) {
                agentInfo += ` [${agent.aiProvider}/${agent.aiModel}]`;
            }

            // Add template info if available
            if (agent.agentTemplate) {
                agentInfo += ` {${agent.agentTemplate}}`;
            }

            lines.push(`      ${connector} ${agentInfo}`);
            lines.push(`      ${isLast ? '  ' : '│  '}   └─ "${truncateText(agent.taskDescription || 'No description', 60)}"`);

            if (!isLast) {
                lines.push(`      │`);
            }
        });
        lines.push('');
    } else {
        lines.push('   └─ 🤖 Direct Processing (No delegation)');
        if (coordinator) {
            lines.push(`      👑 Coordinator: ${coordinator.messages.length} messages`);
        }
        lines.push('');
    }

    // Summary Stats
    const totalAgents = workflowHistory.agentConversations.length;
    const totalMessages = workflowHistory.agentConversations.reduce((sum, agent) => sum + agent.messages.length, 0);
    const coordinators = workflowHistory.agentConversations.filter(agent => !agent.parentAgentId).length;
    const taskAgentsCount = workflowHistory.agentConversations.filter(agent => agent.parentAgentId).length;

    lines.push('📈 Summary');
    lines.push(`   🤖 Agents: ${totalAgents} total (👑 ${coordinators} coordinator, 🎯 ${taskAgentsCount} task agents)`);
    lines.push(`   💬 Messages: ${totalMessages} total`);
    lines.push('');

    // Final Result Preview
    lines.push('🎯 Result Preview');
    const resultLines = workflowHistory.finalResult.split('\n').filter(line => line.trim());
    resultLines.slice(0, 2).forEach((line) => {
        lines.push(`   ${truncateText(line.trim(), 80)}`);
    });
    if (resultLines.length > 2) {
        lines.push(`   ... (${resultLines.length - 2} more lines)`);
    }
    lines.push('');

    return lines.join('\n');
}

/**
 * Generate a simple text diagram of agent relationships
 * 
 * @param workflowHistory - Complete workflow history
 * @returns Simple text diagram showing agent relationships
 * 
 * @example
 * ```ts
 * import { generateAgentRelationshipDiagram } from '@robota-sdk/team/workflow-formatter';
 * 
 * const history = team.getWorkflowHistory();
 * if (history) {
 *   const diagram = generateAgentRelationshipDiagram(history);
 *   console.log(diagram);
 * }
 * ```
 */
export function generateAgentRelationshipDiagram(workflowHistory: WorkflowHistory): string {
    const lines: string[] = [];

    lines.push('');
    lines.push('🔗 Agent Network');
    lines.push('═'.repeat(30));
    lines.push('');

    // Group agents by hierarchy level
    const agentsByLevel = new Map<number, AgentConversationData[]>();

    workflowHistory.agentConversations.forEach(agent => {
        const level = agent.parentAgentId ? 1 : 0;
        if (!agentsByLevel.has(level)) {
            agentsByLevel.set(level, []);
        }
        agentsByLevel.get(level)!.push(agent);
    });

    // Render root agents (level 0)
    const rootAgents = agentsByLevel.get(0) || [];
    if (rootAgents.length > 0) {
        lines.push('👑 Coordinator');
        rootAgents.forEach(agent => {
            lines.push(`   🤖 ${agent.agentId} (${agent.messages.length} messages)`);
        });
        lines.push('');
    }

    // Render child agents (level 1)
    const childAgents = agentsByLevel.get(1) || [];
    if (childAgents.length > 0) {
        lines.push('🎯 Task Agents');

        childAgents.forEach((agent, index) => {
            lines.push(`   └─ 🤖 ${agent.agentId} (${agent.messages.length} msgs)`);
            lines.push(`      "${truncateText(agent.taskDescription || 'No description', 50)}"`);

            if (index < childAgents.length - 1) {
                lines.push('');
            }
        });
        lines.push('');
    }

    // Summary
    const totalAgents = workflowHistory.agentConversations.length;
    const totalMessages = workflowHistory.agentConversations.reduce((sum, agent) => sum + agent.messages.length, 0);

    lines.push('📊 Network Stats');
    lines.push(`   🤖 ${totalAgents} agents, 💬 ${totalMessages} messages`);
    lines.push('');

    return lines.join('\n');
}

/**
 * Convert workflow history to JSON format for external processing
 * 
 * @param workflowHistory - Complete workflow history
 * @returns JSON string representation
 * 
 * @example
 * ```ts
 * import { workflowHistoryToJSON } from '@robota-sdk/team/workflow-formatter';
 * 
 * const history = team.getWorkflowHistory();
 * if (history) {
 *   const jsonData = workflowHistoryToJSON(history);
 *   // Save to file or send to external service
 * }
 * ```
 */
export function workflowHistoryToJSON(workflowHistory: WorkflowHistory): string {
    return JSON.stringify(workflowHistory, null, 2);
}

/**
 * Convert workflow history to CSV format for spreadsheet analysis
 * 
 * @param workflowHistory - Complete workflow history
 * @returns CSV string with agent conversation data
 * 
 * @example
 * ```ts
 * import { workflowHistoryToCSV } from '@robota-sdk/team/workflow-formatter';
 * 
 * const history = team.getWorkflowHistory();
 * if (history) {
 *   const csvData = workflowHistoryToCSV(history);
 *   // Save to .csv file
 * }
 * ```
 */
export function workflowHistoryToCSV(workflowHistory: WorkflowHistory): string {
    const headers = [
        'Execution ID',
        'Agent ID',
        'Parent Agent ID',
        'Task Description',
        'Created At',
        'Message Count',
        'Initial Prompt',
        'Final Response'
    ];

    const rows: string[] = [headers.join(',')];

    for (const agentConv of workflowHistory.agentConversations) {
        const userMessages = agentConv.messages.filter(m => m.role === 'user');
        const assistantMessages = agentConv.messages.filter(m => m.role === 'assistant');

        const initialPrompt = userMessages.length > 0 ? userMessages[0].content || '' : '';
        const finalResponse = assistantMessages.length > 0
            ? assistantMessages[assistantMessages.length - 1].content || ''
            : '';

        const row = [
            workflowHistory.executionId,
            agentConv.agentId,
            agentConv.parentAgentId || '',
            agentConv.taskDescription || '',
            agentConv.createdAt.toISOString(),
            agentConv.messages.length.toString(),
            `"${initialPrompt.replace(/"/g, '""')}"`, // Escape quotes for CSV
            `"${finalResponse.replace(/"/g, '""')}"`
        ];

        rows.push(row.join(','));
    }

    return rows.join('\n');
}

/**
 * Extract performance metrics from workflow history
 * 
 * @param workflowHistory - Complete workflow history
 * @returns Performance metrics object
 * 
 * @example
 * ```ts
 * import { extractPerformanceMetrics } from '@robota-sdk/team/workflow-formatter';
 * 
 * const history = team.getWorkflowHistory();
 * if (history) {
 *   const metrics = extractPerformanceMetrics(history);
 *   console.log(`Total agents: ${metrics.totalAgents}`);
 *   console.log(`Execution time: ${metrics.executionTimeMs}ms`);
 * }
 * ```
 */
export function extractPerformanceMetrics(workflowHistory: WorkflowHistory) {
    const executionTimeMs = workflowHistory.endTime
        ? workflowHistory.endTime.getTime() - workflowHistory.startTime.getTime()
        : null;

    const totalMessages = workflowHistory.agentConversations.reduce(
        (sum, agent) => sum + agent.messages.length,
        0
    );

    const agentsByType = workflowHistory.agentConversations.reduce((acc, agent) => {
        if (agent.agentId === 'team-coordinator') {
            acc.coordinators++;
        } else {
            acc.taskAgents++;
        }
        return acc;
    }, { coordinators: 0, taskAgents: 0 });

    return {
        executionId: workflowHistory.executionId,
        totalAgents: workflowHistory.agentConversations.length,
        coordinators: agentsByType.coordinators,
        taskAgents: agentsByType.taskAgents,
        totalMessages,
        executionTimeMs,
        success: workflowHistory.success,
        error: workflowHistory.error,
        userRequest: workflowHistory.userRequest,
        startTime: workflowHistory.startTime,
        endTime: workflowHistory.endTime
    };
}

/**
 * Get conversation data for a specific agent
 * 
 * @param workflowHistory - Complete workflow history
 * @param agentId - ID of the agent to get conversation for
 * @returns Agent conversation data or null if not found
 * 
 * @example
 * ```ts
 * import { getAgentConversation } from '@robota-sdk/team/workflow-formatter';
 * 
 * const history = team.getWorkflowHistory();
 * if (history) {
 *   const conversation = getAgentConversation(history, 'marketing-expert');
 *   if (conversation) {
 *     console.log(`Agent had ${conversation.messages.length} messages`);
 *   }
 * }
 * ```
 */
export function getAgentConversation(workflowHistory: WorkflowHistory, agentId: string): AgentConversationData | null {
    return workflowHistory.agentConversations.find(conv => conv.agentId === agentId) || null;
}

/**
 * Get all messages from all agents in chronological order
 * 
 * @param workflowHistory - Complete workflow history
 * @returns Array of messages with agent IDs, sorted chronologically
 * 
 * @example
 * ```ts
 * import { getAllMessagesChronologically } from '@robota-sdk/team/workflow-formatter';
 * 
 * const history = team.getWorkflowHistory();
 * if (history) {
 *   const allMessages = getAllMessagesChronologically(history);
 *   allMessages.forEach(msg => {
 *     console.log(`[${msg.agentId}] ${msg.role}: ${msg.content}`);
 *   });
 * }
 * ```
 */
export function getAllMessagesChronologically(workflowHistory: WorkflowHistory): Array<any & { agentId: string }> {
    const allMessages: Array<any & { agentId: string }> = [];

    for (const agentConv of workflowHistory.agentConversations) {
        for (const message of agentConv.messages) {
            allMessages.push({
                ...message,
                agentId: agentConv.agentId
            });
        }
    }

    // Sort by timestamp if available, otherwise maintain order
    allMessages.sort((a, b) => {
        if (a.timestamp && b.timestamp) {
            return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        }
        return 0;
    });

    return allMessages;
}

// Helper functions

/**
 * Render agent tree with improved visual structure
 */
function renderAgentTree(node: AgentTreeNode, prefix: string, isLast: boolean): string[] {
    const lines: string[] = [];
    const connector = isLast ? '└─' : '├─';

    const agentType = node.agentId === 'team-coordinator' ? '👑' : '🤖';
    const agentInfo = `${agentType} ${node.agentId}`;

    lines.push(`${prefix}${connector} ${agentInfo}`);

    // Add task description and message count as sub-items
    const childPrefix = prefix + (isLast ? '   ' : '│  ');

    if (node.taskDescription) {
        lines.push(`${childPrefix}├─ 📋 ${truncateText(node.taskDescription, 60)}`);
    }
    lines.push(`${childPrefix}${node.children.length > 0 ? '├─' : '└─'} 📊 ${node.messageCount} messages`);

    // Render children
    if (node.children.length > 0) {
        for (let i = 0; i < node.children.length; i++) {
            const isLastChild = i === node.children.length - 1;
            lines.push(...renderAgentTree(node.children[i], childPrefix, isLastChild));
        }
    }

    return lines;
}

/**
 * Format duration in a human-readable way
 */
function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    } else if (ms < 60000) {
        return `${(ms / 1000).toFixed(1)}s`;
    } else {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    }
}

/**
 * Truncate text to specified length with ellipsis
 */
function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength - 3) + '...';
} 