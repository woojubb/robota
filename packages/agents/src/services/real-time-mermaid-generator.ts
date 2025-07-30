import {
    WorkflowNode,
    WorkflowNodeType,
    WorkflowNodeStatus,
    WorkflowConnection,
    WorkflowConnectionType
} from './workflow-event-subscriber';
import { WorkflowStructure } from './real-time-workflow-builder';
import { SimpleLogger, SilentLogger } from '../utils/simple-logger';

/**
 * Generates real-time Mermaid diagrams from WorkflowNode structures
 * Converts hierarchical workflow data into Mermaid graph syntax
 */
export class RealTimeMermaidGenerator {
    private readonly logger: SimpleLogger;

    constructor(logger?: SimpleLogger) {
        this.logger = logger || SilentLogger;
    }

    /**
     * Generate Mermaid diagram from workflow structure
     */
    generateMermaidFromWorkflow(workflow: WorkflowStructure): string {
        this.logger.debug('Generating Mermaid diagram from workflow structure');

        const nodes = workflow.nodes || [];
        const connections = workflow.connections || [];

        if (nodes.length === 0) {
            return this.generateEmptyDiagram();
        }

        const mermaidLines: string[] = ['graph TD'];

        // Generate node definitions
        const nodeDefinitions = this.generateNodeDefinitions(nodes);
        mermaidLines.push(...nodeDefinitions);

        // Generate connections
        const connectionDefinitions = this.generateConnectionDefinitions(connections, nodes);
        mermaidLines.push(...connectionDefinitions);

        // Generate styling
        const styleDefinitions = this.generateStyleDefinitions(nodes);
        mermaidLines.push(...styleDefinitions);

        const result = mermaidLines.join('\n    ');
        this.logger.debug(`Generated Mermaid diagram with ${nodes.length} nodes and ${connections.length} connections`);

        return result;
    }

    /**
     * Generate Mermaid diagram from node array
     */
    generateMermaidFromNodes(nodes: WorkflowNode[]): string {
        this.logger.debug('Generating Mermaid diagram from node array');

        if (nodes.length === 0) {
            return this.generateEmptyDiagram();
        }

        const mermaidLines: string[] = ['graph TD'];

        // Filter and organize nodes for better visualization
        const organizedNodes = this.organizeNodesForVisualization(nodes);

        // Generate node definitions
        const nodeDefinitions = this.generateNodeDefinitions(organizedNodes);
        mermaidLines.push(...nodeDefinitions);

        // Generate connections based on node relationships
        const connectionDefinitions = this.generateConnectionsFromNodes(organizedNodes);
        mermaidLines.push(...connectionDefinitions);

        // Generate styling
        const styleDefinitions = this.generateStyleDefinitions(organizedNodes);
        mermaidLines.push(...styleDefinitions);

        return mermaidLines.join('\n    ');
    }

    /**
     * Organize nodes for better visualization by filtering and simplifying
     */
    private organizeNodesForVisualization(nodes: WorkflowNode[]): WorkflowNode[] {
        // Group nodes by level and type for better organization
        const nodesByLevel = new Map<number, WorkflowNode[]>();

        for (const node of nodes) {
            const level = node.level || 0;
            if (!nodesByLevel.has(level)) {
                nodesByLevel.set(level, []);
            }
            nodesByLevel.get(level)!.push(node);
        }

        const organized: WorkflowNode[] = [];

        // Add nodes level by level for better flow
        for (const level of Array.from(nodesByLevel.keys()).sort()) {
            const levelNodes = nodesByLevel.get(level)!;

            // Prioritize certain node types for better visualization
            const priorityOrder = [
                'agent', 'user_input', 'agent_thinking',
                'tool_call', 'sub_agent', 'sub_response',
                'merge_results', 'final_response'
            ];

            const sortedNodes = levelNodes.sort((a, b) => {
                const aIndex = priorityOrder.indexOf(a.type);
                const bIndex = priorityOrder.indexOf(b.type);
                return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
            });

            organized.push(...sortedNodes);
        }

        return organized;
    }

    private generateEmptyDiagram(): string {
        return `graph TD
    A["🤖 No Workflow Data"]
    
    classDef empty fill:#f9f9f9,stroke:#ddd
    class A empty`;
    }

    private generateNodeDefinitions(nodes: WorkflowNode[]): string[] {
        const definitions: string[] = [];

        for (const node of nodes) {
            const nodeId = this.sanitizeNodeId(node.id);
            const nodeLabel = this.generateNodeLabel(node);
            const nodeShape = this.getNodeShape(node.type);

            definitions.push(`${nodeId}${nodeShape.start}"${nodeLabel}"${nodeShape.end}`);
        }

        return definitions;
    }

    private generateConnectionDefinitions(connections: WorkflowConnection[], nodes: WorkflowNode[]): string[] {
        const definitions: string[] = [];
        const nodeIds = new Set(nodes.map(n => this.sanitizeNodeId(n.id)));

        for (const connection of connections) {
            const fromId = this.sanitizeNodeId(connection.fromId);
            const toId = this.sanitizeNodeId(connection.toId);

            // Only add connections between existing nodes
            if (nodeIds.has(fromId) && nodeIds.has(toId)) {
                const arrow = this.getConnectionArrow(connection.type);
                const label = this.getConnectionLabel(connection.type);

                if (label) {
                    definitions.push(`${fromId} ${arrow}|"${label}"| ${toId}`);
                } else {
                    definitions.push(`${fromId} ${arrow} ${toId}`);
                }
            }
        }

        return definitions;
    }

    private generateConnectionsFromNodes(nodes: WorkflowNode[]): string[] {
        const definitions: string[] = [];
        const nodeMap = new Map(nodes.map(n => [n.id, n]));

        for (const node of nodes) {
            if (node.parentId && nodeMap.has(node.parentId)) {
                const fromId = this.sanitizeNodeId(node.parentId);
                const toId = this.sanitizeNodeId(node.id);
                const arrow = this.inferConnectionType(nodeMap.get(node.parentId)!, node);

                definitions.push(`${fromId} ${arrow} ${toId}`);
            }
        }

        return definitions;
    }

    private generateStyleDefinitions(nodes: WorkflowNode[]): string[] {
        return [
            '',
            'classDef agent fill:#e1f5fe,stroke:#01579b,stroke-width:2px',
            'classDef thinking fill:#fff3e0,stroke:#e65100,stroke-width:2px',
            'classDef tool fill:#f3e5f5,stroke:#4a148c,stroke-width:2px',
            'classDef merge fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px',
            'classDef response fill:#fce4ec,stroke:#880e4f,stroke-width:2px',
            'classDef user fill:#f1f8e9,stroke:#33691e,stroke-width:2px',
            'classDef error fill:#ffebee,stroke:#b71c1c,stroke-width:2px',
            '',
            this.generateClassAssignments(nodes)
        ];
    }

    private generateClassAssignments(nodes: WorkflowNode[]): string {
        const nodesByType = new Map<string, string[]>();

        // Group nodes by type
        for (const node of nodes) {
            const nodeId = this.sanitizeNodeId(node.id);
            const type = node.type;

            if (!nodesByType.has(type)) {
                nodesByType.set(type, []);
            }
            nodesByType.get(type)!.push(nodeId);
        }

        const assignments: string[] = [];

        // Assign classes based on node types
        for (const [type, nodeIds] of nodesByType) {
            const className = this.getNodeClassName(type);
            if (className && nodeIds.length > 0) {
                assignments.push(`class ${nodeIds.join(',')} ${className}`);
            }
        }

        return assignments.join('\n');
    }

    private getNodeClassName(type: string): string {
        const classMap: Record<string, string> = {
            'agent': 'agent',
            'sub_agent': 'agent',
            'user_input': 'user',
            'agent_thinking': 'thinking',
            'tool_call': 'tool',
            'merge_results': 'merge',
            'final_response': 'response',
            'sub_response': 'response'
        };

        return classMap[type] || '';
    }

    private sanitizeNodeId(id: string): string {
        // Replace invalid characters for Mermaid
        return id.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
    }

    private generateNodeLabel(node: WorkflowNode): string {
        const emoji = this.getNodeEmoji(node.type);
        const status = this.getStatusEmoji(node.status);

        // Generate simplified, readable labels
        let label = '';

        switch (node.type) {
            case 'agent':
                label = `${emoji} Main Agent`;
                break;
            case 'sub_agent':
                label = `${emoji} Sub-Agent`;
                if (node.data?.agentTemplate) {
                    label += `<br/>(${node.data.agentTemplate})`;
                }
                break;
            case 'tool_call':
                label = `${emoji} Tool Call`;
                if (node.data?.toolName) {
                    label += `<br/>(${node.data.toolName})`;
                }
                break;
            case 'user_input':
                label = `${emoji} User Input`;
                break;
            case 'agent_thinking':
                label = `${emoji} Agent Thinking`;
                break;
            case 'sub_response':
                label = `${emoji} Sub-Response`;
                break;
            case 'merge_results':
                label = `${emoji} Merge Results`;
                break;
            case 'final_response':
                label = `${emoji} Final Response`;
                break;
            default:
                label = `${emoji} ${node.type.replace(/_/g, ' ')}`;
        }

        if (status) {
            label += ` ${status}`;
        }

        return label;
    }

    private getNodeEmoji(type: string): string {
        const emojiMap: Record<string, string> = {
            'agent': '🤖',
            'user_input': '👤',
            'agent_thinking': '💭',
            'tool_call': '⚡',
            'sub_agent': '🤖',
            'sub_response': '💬',
            'merge_results': '🔄',
            'final_response': '💬',
            'error': '❌'
        };

        return emojiMap[type] || '📋';
    }

    private getStatusEmoji(status: string): string {
        const statusMap: Record<string, string> = {
            'pending': '⏳',
            'running': '▶️',
            'completed': '✅',
            'error': '❌'
        };

        return statusMap[status] || '';
    }

    private getNodeShape(type: string): { start: string; end: string } {
        const shapeMap: Record<string, { start: string; end: string }> = {
            'agent': { start: '[', end: ']' },
            'user_input': { start: '(', end: ')' },
            'tool_call': { start: '[', end: ']' },
            'merge_results': { start: '{', end: '}' },
            'final_response': { start: '((', end: '))' },
            'sub_response': { start: '((', end: '))' }
        };

        return shapeMap[type] || { start: '[', end: ']' };
    }

    private getConnectionArrow(type: string): string {
        const arrowMap: Record<string, string> = {
            'processes': '-->',
            'executes': '-->',
            'spawn': '==>',
            'return': '-.->',
            'final': '-->',
            'consolidate': '==>',
            'has_tools': '---',
            'contains': '---'
        };

        return arrowMap[type] || '-->';
    }

    private getConnectionLabel(type: string): string {
        const labelMap: Record<string, string> = {
            'spawn': 'creates',
            'return': 'returns',
            'consolidate': 'merges',
            'has_tools': 'has',
            'contains': 'contains'
        };

        return labelMap[type] || '';
    }

    private inferConnectionType(parent: WorkflowNode, child: WorkflowNode): string {
        // Infer connection type based on node types
        if (parent.type === 'agent_thinking' && child.type === 'tool_call') {
            return '-->';
        }
        if (parent.type === 'tool_call' && child.type === 'sub_agent') {
            return '==>';
        }
        if (parent.type === 'sub_agent' && child.type === 'sub_response') {
            return '-->';
        }
        if (child.type === 'merge_results') {
            return '-.->';
        }

        return '-->';
    }

    /**
     * Generate a simplified Mermaid diagram for debugging
     */
    generateSimplifiedDiagram(nodes: WorkflowNode[]): string {
        const mermaidLines: string[] = ['graph TD'];

        // Group nodes by level
        const nodesByLevel = new Map<number, WorkflowNode[]>();
        for (const node of nodes) {
            const level = node.level || 0;
            if (!nodesByLevel.has(level)) {
                nodesByLevel.set(level, []);
            }
            nodesByLevel.get(level)!.push(node);
        }

        // Generate simplified representation
        for (const [level, levelNodes] of nodesByLevel) {
            const levelEmoji = level === 0 ? '🎯' : level === 1 ? '🔧' : '🌟';
            mermaidLines.push(`    L${level}["${levelEmoji} Level ${level}: ${levelNodes.length} nodes"]`);

            if (level > 0) {
                mermaidLines.push(`    L${level - 1} --> L${level}`);
            }
        }

        return mermaidLines.join('\n');
    }
}