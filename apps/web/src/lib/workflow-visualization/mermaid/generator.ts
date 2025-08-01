/**
 * Real-Time Mermaid Generator for Web Application
 * 
 * Purpose: Generates real-time Mermaid diagrams from Universal workflow structures
 * Architecture: Depends on agents package for workflow types, provides web-specific rendering
 * Features: Converts hierarchical workflow data into Mermaid graph syntax
 * 
 * Moved from packages/agents to maintain domain separation
 */

import type {
    UniversalWorkflowStructure,
    UniversalWorkflowNode,
    UniversalWorkflowEdge
} from '@robota-sdk/agents';

import {
    BaseVisualizationGenerator,
    SilentLogger
} from '@robota-sdk/agents';

import type {
    BaseVisualizationConfig,
    VisualizationResult
} from '@robota-sdk/agents';

import type {
    WorkflowNode,
    WorkflowNodeType,
    WorkflowNodeStatus,
    WorkflowConnection,
    WorkflowConnectionType
} from '@robota-sdk/agents';

import type {
    MermaidNodeClassMapping,
    MermaidNodeEmojiMapping,
    MermaidStatusMapping,
    MermaidShapeMapping,
    MermaidArrowMapping,
    MermaidLabelMapping,
    MermaidDiagramConfig
} from './types';

/**
 * Mermaid-specific visualization configuration
 * Extends base configuration with Mermaid-specific options
 */
export interface MermaidVisualizationConfig extends BaseVisualizationConfig {
    /** Mermaid diagram configuration */
    diagramConfig?: MermaidDiagramConfig;

    /** Custom node class mappings */
    nodeClassMappings?: Partial<MermaidNodeClassMapping>;

    /** Custom emoji mappings */
    emojiMappings?: Partial<MermaidNodeEmojiMapping>;

    /** Include debug information in output */
    includeDebug?: boolean;
}

/**
 * Generates real-time Mermaid diagrams from workflow structures
 * Supports both legacy WorkflowStructure and new UniversalWorkflowStructure
 * 
 * Extends BaseVisualizationGenerator with Mermaid-specific implementation
 */
export class RealTimeMermaidGenerator extends BaseVisualizationGenerator<MermaidVisualizationConfig, string> {

    constructor(config?: Partial<MermaidVisualizationConfig>) {
        // Create complete configuration with defaults
        const fullConfig: MermaidVisualizationConfig = {
            diagramConfig: {
                direction: 'TB',
                theme: 'default'
            },
            includeDebug: false,
            ...config,
            // Base config properties
            platform: 'mermaid',
            logger: config?.logger || SilentLogger
        };

        super(fullConfig);
    }

    // ================================
    // BaseVisualizationGenerator Abstract Methods Implementation
    // ================================

    /**
     * Prepare platform-specific data structures from Universal workflow
     */
    protected async prepareVisualizationData(workflow: UniversalWorkflowStructure): Promise<{
        nodes: UniversalWorkflowNode[];
        edges: UniversalWorkflowEdge[];
        config: MermaidVisualizationConfig;
    }> {
        return {
            nodes: workflow.nodes || [],
            edges: workflow.edges || [],
            config: this.config
        };
    }

    /**
     * Generate the actual Mermaid visualization output from prepared data
     */
    protected async generateVisualizationOutput(preparedData: {
        nodes: UniversalWorkflowNode[];
        edges: UniversalWorkflowEdge[];
        config: MermaidVisualizationConfig;
    }): Promise<string> {
        const { nodes, edges } = preparedData;

        if (nodes.length === 0) {
            return this.getEmptyVisualization();
        }

        const mermaidLines: string[] = ['graph TD'];

        // Generate node definitions from Universal nodes
        const nodeDefinitions = this.generateUniversalNodeDefinitions(nodes);
        mermaidLines.push(...nodeDefinitions);

        // Generate connections from Universal edges
        const connectionDefinitions = this.generateUniversalConnectionDefinitions(edges, nodes);
        mermaidLines.push(...connectionDefinitions);

        // Generate styling
        const styleDefinitions = this.generateUniversalStyleDefinitions(nodes);
        mermaidLines.push(...styleDefinitions);

        return mermaidLines.join('\n    ');
    }

    /**
     * Get platform-specific empty visualization
     */
    protected getEmptyVisualization(): string {
        return 'graph TD\n    empty["No workflow data available"]';
    }

    // ================================
    // Public Convenience Methods (Legacy Support)
    // ================================

    /**
     * Generate Mermaid diagram from Universal workflow structure
     */
    async generateMermaidFromUniversal(workflow: UniversalWorkflowStructure): Promise<string> {
        const result = await this.generateVisualization(workflow);
        return result.output;
    }

    /**
     * Generate Mermaid diagram from Universal workflow structure (sync version)
     * @deprecated Use generateMermaidFromUniversal (async) for better error handling
     */
    generateMermaidFromUniversalSync(workflow: UniversalWorkflowStructure): string {
        this.config.logger?.debug('Generating Mermaid diagram from Universal workflow structure (sync)');

        const nodes = workflow.nodes || [];
        const edges = workflow.edges || [];

        if (nodes.length === 0) {
            return this.getEmptyVisualization();
        }

        const mermaidLines: string[] = ['graph TD'];

        // Generate node definitions from Universal nodes
        const nodeDefinitions = this.generateUniversalNodeDefinitions(nodes);
        mermaidLines.push(...nodeDefinitions);

        // Generate connections from Universal edges
        const connectionDefinitions = this.generateUniversalConnectionDefinitions(edges, nodes);
        mermaidLines.push(...connectionDefinitions);

        // Generate styling
        const styleDefinitions = this.generateUniversalStyleDefinitions(nodes);
        mermaidLines.push(...styleDefinitions);

        const result = mermaidLines.join('\n    ');
        this.config.logger?.debug(`Generated Mermaid diagram with ${nodes.length} nodes and ${edges.length} connections`);

        return result;
    }

    /**
     * Generate Mermaid diagram from legacy workflow structure
     * @deprecated Use generateMermaidFromUniversal for new implementations
     */
    generateMermaidFromWorkflow(workflow: any): string {
        this.config.logger?.debug('Generating Mermaid diagram from legacy workflow structure');

        const nodes = workflow.nodes || [];
        const connections = workflow.connections || [];

        if (nodes.length === 0) {
            return this.getEmptyVisualization();
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
        this.config.logger?.debug(`Generated Mermaid diagram with ${nodes.length} nodes and ${connections.length} connections`);

        return result;
    }

    /**
     * Generate Mermaid diagram from Universal node array
     */
    generateMermaidFromUniversalNodes(nodes: UniversalWorkflowNode[]): string {
        this.config.logger?.debug('Generating Mermaid diagram from Universal node array');

        if (nodes.length === 0) {
            return this.getEmptyVisualization();
        }

        const mermaidLines: string[] = ['graph TD'];

        // Generate Universal node definitions
        const nodeDefinitions = this.generateUniversalNodeDefinitions(nodes);
        mermaidLines.push(...nodeDefinitions);

        // Generate connections based on node relationships
        const connectionDefinitions = this.generateUniversalConnectionsFromNodes(nodes);
        mermaidLines.push(...connectionDefinitions);

        // Generate styling
        const styleDefinitions = this.generateUniversalStyleDefinitions(nodes);
        mermaidLines.push(...styleDefinitions);

        return mermaidLines.join('\n    ');
    }

    /**
     * Generate Mermaid diagram from legacy node array
     * @deprecated Use generateMermaidFromUniversalNodes for new implementations
     */
    generateMermaidFromNodes(nodes: WorkflowNode[]): string {
        this.config.logger?.debug('Generating Mermaid diagram from legacy node array');

        if (nodes.length === 0) {
            return this.getEmptyVisualization();
        }

        const mermaidLines: string[] = ['graph TD'];

        // Sort nodes by level and order for consistent layout
        const sortedNodes = [...nodes].sort((a, b) => {
            if (a.level !== b.level) return a.level - b.level;
            return a.order - b.order;
        });

        // Generate node definitions
        const nodeDefinitions = this.generateNodeDefinitions(sortedNodes);
        mermaidLines.push(...nodeDefinitions);

        // Generate connections
        const connectionDefinitions = this.generateConnectionsFromNodes(sortedNodes);
        mermaidLines.push(...connectionDefinitions);

        // Generate styling
        const styleDefinitions = this.generateStyleDefinitions(sortedNodes);
        mermaidLines.push(...styleDefinitions);

        return mermaidLines.join('\n    ');
    }

    /**
     * Generate Universal node definitions
     */
    private generateUniversalNodeDefinitions(nodes: UniversalWorkflowNode[]): string[] {
        return nodes.map(node => {
            const label = this.sanitizeMermaidText(node.data.label || node.id);
            const emoji = this.getEmojiForUniversalNode(node);
            const shape = this.getShapeForUniversalNode(node);

            const displayLabel = emoji ? `${emoji} ${label}` : label;
            return `    ${node.id}${shape.start}${displayLabel}${shape.end}`;
        });
    }

    /**
     * Generate Universal connection definitions
     */
    private generateUniversalConnectionDefinitions(edges: UniversalWorkflowEdge[], nodes: UniversalWorkflowNode[]): string[] {
        return edges.map(edge => {
            const arrow = this.getArrowForUniversalEdge(edge);
            const label = edge.label ? this.sanitizeMermaidText(edge.label) : '';

            if (label) {
                return `    ${edge.source} ${arrow}|${label}| ${edge.target}`;
            } else {
                return `    ${edge.source} ${arrow} ${edge.target}`;
            }
        });
    }

    /**
     * Generate Universal connections from node relationships
     */
    private generateUniversalConnectionsFromNodes(nodes: UniversalWorkflowNode[]): string[] {
        const connections: string[] = [];

        // Create connections based on hierarchy and relationships
        nodes.forEach(node => {
            // Connect to parent if exists
            if (node.parentId) {
                const parentExists = nodes.some(n => n.id === node.parentId);
                if (parentExists) {
                    connections.push(`    ${node.parentId} --> ${node.id}`);
                }
            }

            // Create level-based connections for nodes without explicit parents
            if (!node.parentId && node.position.level > 0) {
                const previousLevelNodes = nodes.filter(n =>
                    n.position.level === node.position.level - 1
                );

                if (previousLevelNodes.length > 0) {
                    // Connect to the closest node in the previous level
                    const closestNode = previousLevelNodes.reduce((closest, candidate) => {
                        const currentDistance = Math.abs(candidate.position.order - node.position.order);
                        const closestDistance = Math.abs(closest.position.order - node.position.order);
                        return currentDistance < closestDistance ? candidate : closest;
                    });

                    connections.push(`    ${closestNode.id} --> ${node.id}`);
                }
            }
        });

        return connections;
    }

    /**
     * Generate Universal style definitions
     */
    private generateUniversalStyleDefinitions(nodes: UniversalWorkflowNode[]): string[] {
        const styles: string[] = [];

        nodes.forEach(node => {
            const className = this.getClassForUniversalNode(node);
            if (className) {
                styles.push(`    class ${node.id} ${className}`);
            }
        });

        return styles;
    }

    /**
     * Generate legacy node definitions
     */
    private generateNodeDefinitions(nodes: WorkflowNode[]): string[] {
        return nodes.map(node => {
            const label = this.sanitizeMermaidText(node.label || node.id);
            const emoji = this.getEmojiForNode(node);
            const shape = this.getShapeForNode(node);

            const displayLabel = emoji ? `${emoji} ${label}` : label;
            return `    ${node.id}${shape.start}${displayLabel}${shape.end}`;
        });
    }

    /**
     * Generate legacy connection definitions
     */
    private generateConnectionDefinitions(connections: WorkflowConnection[], nodes: WorkflowNode[]): string[] {
        return connections
            .filter(conn => {
                // Ensure both source and target nodes exist
                const sourceExists = nodes.some(n => n.id === conn.source);
                const targetExists = nodes.some(n => n.id === conn.target);
                return sourceExists && targetExists;
            })
            .map(conn => {
                const arrow = this.getArrowForConnection(conn);
                const label = conn.label ? this.sanitizeMermaidText(conn.label) : '';

                if (label) {
                    return `    ${conn.source} ${arrow}|${label}| ${conn.target}`;
                } else {
                    return `    ${conn.source} ${arrow} ${conn.target}`;
                }
            });
    }

    /**
     * Generate legacy connections from nodes
     */
    private generateConnectionsFromNodes(nodes: WorkflowNode[]): string[] {
        const connections: string[] = [];

        nodes.forEach(node => {
            node.connections.forEach(conn => {
                const targetExists = nodes.some(n => n.id === conn.target);
                if (targetExists) {
                    const arrow = this.getArrowForConnectionType(conn.type);
                    const label = conn.label ? this.sanitizeMermaidText(conn.label) : '';

                    if (label) {
                        connections.push(`    ${node.id} ${arrow}|${label}| ${conn.target}`);
                    } else {
                        connections.push(`    ${node.id} ${arrow} ${conn.target}`);
                    }
                }
            });
        });

        return connections;
    }

    /**
     * Generate legacy style definitions
     */
    private generateStyleDefinitions(nodes: WorkflowNode[]): string[] {
        const styles: string[] = [];

        nodes.forEach(node => {
            const className = this.getClassForNode(node);
            if (className) {
                styles.push(`    class ${node.id} ${className}`);
            }
        });

        return styles;
    }

    /**
     * Get emoji for Universal node
     */
    private getEmojiForUniversalNode(node: UniversalWorkflowNode): string {
        const emojiMap: MermaidNodeEmojiMapping = {
            'user_input': '👤',
            'output': '📤',
            'agent': '🤖',
            'sub_agent': '🤖',
            'tools_container': '🛠️',
            'tool_definition': '⚙️',
            'agent_thinking': '💭',
            'tool_call': '🔧',
            'sub_tool_call': '🔧',
            'merge_results': '🔄',
            'sub_merge': '🔄',
            'final_response': '✅',
            'sub_response': '✅'
        };

        return emojiMap[node.type] || '';
    }

    /**
     * Get shape for Universal node
     */
    private getShapeForUniversalNode(node: UniversalWorkflowNode): { start: string; end: string } {
        const shapeMap: MermaidShapeMapping = {
            'user_input': { start: '([', end: '])' },
            'output': { start: '([', end: '])' },
            'agent': { start: '[', end: ']' },
            'sub_agent': { start: '[', end: ']' },
            'tools_container': { start: '((', end: '))' },
            'tool_definition': { start: '(', end: ')' },
            'agent_thinking': { start: '{', end: '}' },
            'tool_call': { start: '(', end: ')' },
            'sub_tool_call': { start: '(', end: ')' },
            'merge_results': { start: '{{', end: '}}' },
            'sub_merge': { start: '{{', end: '}}' },
            'final_response': { start: '[', end: ']' },
            'sub_response': { start: '[', end: ']' }
        };

        return shapeMap[node.type] || { start: '[', end: ']' };
    }

    /**
     * Get class for Universal node
     */
    private getClassForUniversalNode(node: UniversalWorkflowNode): string {
        const classMap: MermaidNodeClassMapping = {
            'user_input': 'userInputClass',
            'output': 'outputClass',
            'agent': 'agentClass',
            'sub_agent': 'subAgentClass',
            'tools_container': 'toolsContainerClass',
            'tool_definition': 'toolDefinitionClass',
            'agent_thinking': 'thinkingClass',
            'tool_call': 'toolCallClass',
            'sub_tool_call': 'subToolCallClass',
            'merge_results': 'mergeClass',
            'sub_merge': 'subMergeClass',
            'final_response': 'responseClass',
            'sub_response': 'subResponseClass'
        };

        let className = classMap[node.type] || 'defaultClass';

        // Add status-based class suffix
        if (node.visualState?.status) {
            const statusMap: MermaidStatusMapping = {
                'pending': 'Pending',
                'running': 'Running',
                'completed': 'Completed',
                'error': 'Error',
                'cancelled': 'Cancelled'
            };

            const statusSuffix = statusMap[node.visualState.status];
            if (statusSuffix) {
                className += statusSuffix;
            }
        }

        return className;
    }

    /**
     * Get arrow for Universal edge
     */
    private getArrowForUniversalEdge(edge: UniversalWorkflowEdge): string {
        const arrowMap: MermaidArrowMapping = {
            'sequence': '-->',
            'condition': '-.->',
            'loop': '==>',
            'error': 'x-->x',
            'data': '===',
            'dependency': '-.->',
            'parallel': '==>',
            'merge': '-->',
            'tool_flow': '-->',
            'sub_flow': '-.->',
            'response_flow': '-->'
        };

        return arrowMap[edge.type] || '-->';
    }

    /**
     * Get emoji for legacy node
     */
    private getEmojiForNode(node: WorkflowNode): string {
        const emojiMap: MermaidNodeEmojiMapping = {
            'user_input': '👤',
            'output': '📤',
            'agent': '🤖',
            'sub_agent': '🤖',
            'tools_container': '🛠️',
            'tool_definition': '⚙️',
            'agent_thinking': '💭',
            'tool_call': '🔧',
            'sub_tool_call': '🔧',
            'merge_results': '🔄',
            'sub_merge': '🔄',
            'final_response': '✅',
            'sub_response': '✅'
        };

        return emojiMap[node.type as keyof typeof emojiMap] || '';
    }

    /**
     * Get shape for legacy node
     */
    private getShapeForNode(node: WorkflowNode): { start: string; end: string } {
        const shapeMap: MermaidShapeMapping = {
            'user_input': { start: '([', end: '])' },
            'output': { start: '([', end: '])' },
            'agent': { start: '[', end: ']' },
            'sub_agent': { start: '[', end: ']' },
            'tools_container': { start: '((', end: '))' },
            'tool_definition': { start: '(', end: ')' },
            'agent_thinking': { start: '{', end: '}' },
            'tool_call': { start: '(', end: ')' },
            'sub_tool_call': { start: '(', end: ')' },
            'merge_results': { start: '{{', end: '}}' },
            'sub_merge': { start: '{{', end: '}}' },
            'final_response': { start: '[', end: ']' },
            'sub_response': { start: '[', end: ']' }
        };

        return shapeMap[node.type as keyof typeof shapeMap] || { start: '[', end: ']' };
    }

    /**
     * Get class for legacy node
     */
    private getClassForNode(node: WorkflowNode): string {
        const classMap: MermaidNodeClassMapping = {
            'user_input': 'userInputClass',
            'output': 'outputClass',
            'agent': 'agentClass',
            'sub_agent': 'subAgentClass',
            'tools_container': 'toolsContainerClass',
            'tool_definition': 'toolDefinitionClass',
            'agent_thinking': 'thinkingClass',
            'tool_call': 'toolCallClass',
            'sub_tool_call': 'subToolCallClass',
            'merge_results': 'mergeClass',
            'sub_merge': 'subMergeClass',
            'final_response': 'responseClass',
            'sub_response': 'subResponseClass'
        };

        let className = classMap[node.type as keyof typeof classMap] || 'defaultClass';

        // Add status-based class suffix
        if (node.status) {
            const statusMap: MermaidStatusMapping = {
                'pending': 'Pending',
                'running': 'Running',
                'completed': 'Completed',
                'error': 'Error',
                'cancelled': 'Cancelled'
            };

            const statusSuffix = statusMap[node.status as keyof typeof statusMap];
            if (statusSuffix) {
                className += statusSuffix;
            }
        }

        return className;
    }

    /**
     * Get arrow for legacy connection
     */
    private getArrowForConnection(conn: WorkflowConnection): string {
        return this.getArrowForConnectionType(conn.type);
    }

    /**
     * Get arrow for legacy connection type
     */
    private getArrowForConnectionType(type: WorkflowConnectionType): string {
        const arrowMap: MermaidArrowMapping = {
            'sequence': '-->',
            'condition': '-.->',
            'loop': '==>',
            'error': 'x-->x',
            'data': '===',
            'dependency': '-.->',
            'parallel': '==>',
            'merge': '-->',
            'tool_flow': '-->',
            'sub_flow': '-.->',
            'response_flow': '-->'
        };

        return arrowMap[type] || '-->';
    }

    /**
     * Replace invalid characters for Mermaid
     */
    private sanitizeMermaidText(text: string): string {
        return text
            .replace(/[[\](){}]/g, '') // Remove brackets and parentheses
            .replace(/['"]/g, '') // Remove quotes
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }

    /**
     * Generate empty diagram
     */
    private generateEmptyDiagram(): string {
        return 'graph TD\n    empty["No workflow data available"]';
    }

    /**
     * Generate a simplified Mermaid diagram for debugging
     */
    generateDebugDiagram(nodes: WorkflowNode[]): string {
        const mermaidLines: string[] = ['graph TD'];

        // Group nodes by level
        const nodesByLevel = nodes.reduce((acc, node) => {
            if (!acc[node.level]) acc[node.level] = [];
            acc[node.level].push(node);
            return acc;
        }, {} as Record<number, WorkflowNode[]>);

        // Create level nodes
        Object.entries(nodesByLevel).forEach(([level, levelNodes]) => {
            const levelEmoji = level === '0' ? '🏁' : level === String(Math.max(...Object.keys(nodesByLevel).map(Number))) ? '🎯' : '⚡';
            mermaidLines.push(`    L${level}["${levelEmoji} Level ${level}: ${levelNodes.length} nodes"]`);

            // Connect levels
            if (parseInt(level) > 0) {
                mermaidLines.push(`    L${level - 1} --> L${level}`);
            }
        });

        return mermaidLines.join('\n');
    }
}