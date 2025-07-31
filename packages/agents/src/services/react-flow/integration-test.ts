/**
 * React-Flow Integration Test
 * 
 * Purpose: Test the complete Universal → React-Flow conversion pipeline
 * Architecture: Integration testing with real data validation
 * Patterns: Test Factory, Builder Pattern
 */

import type { SimpleLogger } from '../../utils/simple-logger';
import { DefaultConsoleLogger } from '../../utils/simple-logger';
import { UniversalToReactFlowConverter } from './index';
import { ReactFlowLayoutEngine } from './layout-engine';
import { ReactFlowMetadataMapper } from './metadata-mapper';
import type {
    ReactFlowData,
    ReactFlowConverterConfig,
    ReactFlowLayoutConfig,
    MetadataMappingConfig
} from './types';
import type {
    UniversalWorkflowStructure,
    UniversalWorkflowNode,
    UniversalWorkflowEdge
} from '../workflow-converter/universal-types';
import type { WorkflowConversionOptions } from '../../interfaces/workflow-converter';

/**
 * Test configuration for React-Flow integration
 */
export interface ReactFlowTestConfig {
    converter?: ReactFlowConverterConfig;
    layout?: ReactFlowLayoutConfig;
    metadata?: MetadataMappingConfig;
    enableValidation?: boolean;
    enableLogging?: boolean;
}

/**
 * Test result for React-Flow integration
 */
export interface ReactFlowTestResult {
    success: boolean;
    conversionResult?: {
        success: boolean;
        nodeCount: number;
        edgeCount: number;
        processingTime: number;
    };
    layoutResult?: {
        success: boolean;
        algorithm: string;
        processingTime: number;
    };
    validationResult?: {
        success: boolean;
        errors: string[];
        warnings: string[];
    };
    error?: string;
    totalProcessingTime: number;
}

/**
 * React-Flow Integration Tester
 * 
 * Features:
 * - End-to-end conversion testing
 * - Performance benchmarking
 * - Data validation and verification
 * - Error handling and reporting
 * - Sample data generation
 */
export class ReactFlowIntegrationTester {

    private readonly logger: SimpleLogger;
    private readonly config: ReactFlowTestConfig;

    constructor(
        config: ReactFlowTestConfig = {},
        logger?: SimpleLogger
    ) {
        this.config = {
            enableValidation: true,
            enableLogging: true,
            ...config
        };

        this.logger = logger || (config.enableLogging ? DefaultConsoleLogger : new MockLogger());
    }

    /**
     * Run complete integration test
     */
    public async runIntegrationTest(): Promise<ReactFlowTestResult> {
        const startTime = Date.now();

        this.logger.info('Starting React-Flow integration test');

        try {
            // 1. Generate test data
            const testData = await this.generateTestData();
            this.logger.debug('Generated test data', {
                nodeCount: testData.nodes.length,
                edgeCount: testData.edges.length
            });

            // 2. Test conversion
            const conversionResult = await this.testConversion(testData);
            if (!conversionResult.success) {
                return {
                    success: false,
                    error: 'Conversion test failed',
                    conversionResult,
                    totalProcessingTime: Date.now() - startTime
                };
            }

            // 3. Test layout
            const layoutResult = await this.testLayout(conversionResult.data!);
            if (!layoutResult.success) {
                return {
                    success: false,
                    error: 'Layout test failed',
                    conversionResult,
                    layoutResult,
                    totalProcessingTime: Date.now() - startTime
                };
            }

            // 4. Test validation
            let validationResult;
            if (this.config.enableValidation) {
                validationResult = await this.testValidation(layoutResult.data!);
            }

            const totalProcessingTime = Date.now() - startTime;

            this.logger.info('React-Flow integration test completed', {
                success: true,
                totalProcessingTime
            });

            return {
                success: true,
                conversionResult,
                layoutResult,
                validationResult,
                totalProcessingTime
            };

        } catch (error) {
            const totalProcessingTime = Date.now() - startTime;
            this.logger.error('React-Flow integration test failed', { error });

            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown test error',
                totalProcessingTime
            };
        }
    }

    /**
     * Test the Universal → React-Flow conversion
     */
    public async testConversion(
        testData: UniversalWorkflowStructure
    ): Promise<{
        success: boolean;
        data?: ReactFlowData;
        nodeCount: number;
        edgeCount: number;
        processingTime: number;
        error?: string;
    }> {

        const startTime = Date.now();
        this.logger.debug('Testing conversion phase');

        try {
            const converter = new UniversalToReactFlowConverter(
                this.config.converter,
                this.logger
            );

            const options: WorkflowConversionOptions = {
                validateInput: this.config.enableValidation,
                validateOutput: this.config.enableValidation,
                includeDebug: this.config.enableLogging
            };

            const result = await converter.convert(testData, options);
            const processingTime = Date.now() - startTime;

            if (!result.success || !result.data) {
                return {
                    success: false,
                    nodeCount: 0,
                    edgeCount: 0,
                    processingTime,
                    error: result.error || 'Unknown conversion error'
                };
            }

            return {
                success: true,
                data: result.data,
                nodeCount: result.data.nodes.length,
                edgeCount: result.data.edges.length,
                processingTime
            };

        } catch (error) {
            return {
                success: false,
                nodeCount: 0,
                edgeCount: 0,
                processingTime: Date.now() - startTime,
                error: error instanceof Error ? error.message : 'Unknown conversion error'
            };
        }
    }

    /**
     * Test the React-Flow layout engine
     */
    public async testLayout(
        reactFlowData: ReactFlowData
    ): Promise<{
        success: boolean;
        data?: ReactFlowData;
        algorithm: string;
        processingTime: number;
        error?: string;
    }> {

        const startTime = Date.now();
        this.logger.debug('Testing layout phase');

        try {
            const layoutEngine = new ReactFlowLayoutEngine(
                this.config.layout,
                this.logger
            );

            const options = {
                validateInput: this.config.enableValidation,
                validateOutput: this.config.enableValidation,
                includeDebug: this.config.enableLogging,
                algorithm: this.config.layout?.algorithm || 'hierarchical'
            };

            const result = await layoutEngine.calculateLayout(reactFlowData, options);
            const processingTime = Date.now() - startTime;

            if (!result.success || !result.data) {
                return {
                    success: false,
                    algorithm: options.algorithm,
                    processingTime,
                    error: result.error || 'Unknown layout error'
                };
            }

            return {
                success: true,
                data: result.data,
                algorithm: options.algorithm,
                processingTime
            };

        } catch (error) {
            return {
                success: false,
                algorithm: this.config.layout?.algorithm || 'hierarchical',
                processingTime: Date.now() - startTime,
                error: error instanceof Error ? error.message : 'Unknown layout error'
            };
        }
    }

    /**
     * Test validation of React-Flow data
     */
    public async testValidation(
        reactFlowData: ReactFlowData
    ): Promise<{
        success: boolean;
        errors: string[];
        warnings: string[];
    }> {

        this.logger.debug('Testing validation phase');

        const errors: string[] = [];
        const warnings: string[] = [];

        try {
            // Validate basic structure
            if (!reactFlowData.nodes || !Array.isArray(reactFlowData.nodes)) {
                errors.push('Invalid nodes array');
            }

            if (!reactFlowData.edges || !Array.isArray(reactFlowData.edges)) {
                errors.push('Invalid edges array');
            }

            // Validate nodes
            reactFlowData.nodes.forEach((node, index) => {
                if (!node.id) {
                    errors.push(`Node ${index} missing id`);
                }

                if (!node.position || typeof node.position.x !== 'number' || typeof node.position.y !== 'number') {
                    errors.push(`Node ${node.id || index} missing valid position`);
                }

                if (!node.data || typeof node.data !== 'object') {
                    errors.push(`Node ${node.id || index} missing data`);
                }

                if (!node.data?.label) {
                    warnings.push(`Node ${node.id || index} missing label`);
                }
            });

            // Validate edges
            reactFlowData.edges.forEach((edge, index) => {
                if (!edge.id) {
                    errors.push(`Edge ${index} missing id`);
                }

                if (!edge.source) {
                    errors.push(`Edge ${edge.id || index} missing source`);
                }

                if (!edge.target) {
                    errors.push(`Edge ${edge.id || index} missing target`);
                }

                // Check if source and target nodes exist
                const sourceExists = reactFlowData.nodes.some(n => n.id === edge.source);
                const targetExists = reactFlowData.nodes.some(n => n.id === edge.target);

                if (!sourceExists) {
                    errors.push(`Edge ${edge.id || index} references non-existent source node: ${edge.source}`);
                }

                if (!targetExists) {
                    errors.push(`Edge ${edge.id || index} references non-existent target node: ${edge.target}`);
                }
            });

            // Validate viewport
            if (reactFlowData.viewport) {
                if (typeof reactFlowData.viewport.x !== 'number' ||
                    typeof reactFlowData.viewport.y !== 'number' ||
                    typeof reactFlowData.viewport.zoom !== 'number') {
                    errors.push('Invalid viewport configuration');
                }
            }

            // Performance warnings
            if (reactFlowData.nodes.length > 1000) {
                warnings.push(`Large node count: ${reactFlowData.nodes.length} nodes may impact performance`);
            }

            if (reactFlowData.edges.length > 2000) {
                warnings.push(`Large edge count: ${reactFlowData.edges.length} edges may impact performance`);
            }

            return {
                success: errors.length === 0,
                errors,
                warnings
            };

        } catch (error) {
            return {
                success: false,
                errors: [error instanceof Error ? error.message : 'Unknown validation error'],
                warnings
            };
        }
    }

    /**
     * Generate test data for integration testing
     */
    public async generateTestData(): Promise<UniversalWorkflowStructure> {

        this.logger.debug('Generating test data');

        // Create test nodes
        const nodes: UniversalWorkflowNode[] = [
            {
                id: 'agent-1',
                type: 'agent',
                position: { x: 0, y: 0 },
                data: {
                    label: 'Main Agent',
                    description: 'Primary conversation agent',
                    metadata: {
                        timestamp: new Date(),
                        executionId: 'exec-001',
                        role: 'primary'
                    }
                },
                visualState: {
                    selected: false,
                    draggable: true,
                    hidden: false
                }
            },
            {
                id: 'tool-1',
                type: 'tool_call',
                position: { x: 200, y: 100 },
                data: {
                    label: 'Calculator Tool',
                    description: 'Mathematical calculations',
                    toolName: 'calculator',
                    status: 'completed',
                    metadata: {
                        timestamp: new Date(),
                        executionTime: 150,
                        result: 'success'
                    }
                },
                visualState: {
                    selected: false,
                    draggable: true,
                    hidden: false
                }
            },
            {
                id: 'user-1',
                type: 'user_input',
                position: { x: -200, y: 100 },
                data: {
                    label: 'User Input',
                    description: 'User query or request',
                    metadata: {
                        timestamp: new Date(),
                        userId: 'user-123',
                        inputType: 'text'
                    }
                },
                visualState: {
                    selected: false,
                    draggable: true,
                    hidden: false
                }
            },
            {
                id: 'response-1',
                type: 'response',
                position: { x: 0, y: 200 },
                data: {
                    label: 'Agent Response',
                    description: 'Final response to user',
                    metadata: {
                        timestamp: new Date(),
                        responseTime: 500,
                        confidence: 0.95
                    }
                },
                visualState: {
                    selected: false,
                    draggable: true,
                    hidden: false
                }
            }
        ];

        // Create test edges
        const edges: UniversalWorkflowEdge[] = [
            {
                id: 'edge-1',
                source: 'user-1',
                target: 'agent-1',
                type: 'execution',
                data: {
                    label: 'User Input',
                    description: 'Input flow to agent',
                    metadata: {
                        timestamp: new Date(),
                        priority: 'high'
                    }
                },
                visualState: {
                    selected: false,
                    hidden: false
                }
            },
            {
                id: 'edge-2',
                source: 'agent-1',
                target: 'tool-1',
                type: 'creation',
                data: {
                    label: 'Tool Call',
                    description: 'Agent calls calculator tool',
                    metadata: {
                        timestamp: new Date(),
                        toolCall: 'calculate'
                    }
                },
                visualState: {
                    selected: false,
                    hidden: false
                }
            },
            {
                id: 'edge-3',
                source: 'tool-1',
                target: 'agent-1',
                type: 'return',
                data: {
                    label: 'Tool Result',
                    description: 'Tool returns result to agent',
                    metadata: {
                        timestamp: new Date(),
                        result: 'calculated'
                    }
                },
                visualState: {
                    selected: false,
                    hidden: false
                }
            },
            {
                id: 'edge-4',
                source: 'agent-1',
                target: 'response-1',
                type: 'execution',
                data: {
                    label: 'Final Response',
                    description: 'Agent generates response',
                    metadata: {
                        timestamp: new Date(),
                        final: true
                    }
                },
                visualState: {
                    selected: false,
                    hidden: false
                }
            }
        ];

        // Create test workflow structure
        const workflow: UniversalWorkflowStructure = {
            __workflowType: 'UniversalWorkflowStructure',
            nodes,
            edges,
            metadata: {
                timestamp: new Date(),
                title: 'Test Workflow',
                description: 'Integration test workflow for React-Flow conversion',
                version: '1.0.0',
                creator: 'ReactFlowIntegrationTester',
                tags: ['test', 'integration', 'react-flow']
            },
            layoutConfig: {
                algorithm: 'hierarchical',
                direction: 'TB',
                nodeSpacing: {
                    horizontal: 150,
                    vertical: 100
                }
            }
        };

        return workflow;
    }

    /**
     * Run performance benchmark
     */
    public async runPerformanceBenchmark(
        nodeCount: number = 100,
        edgeCount: number = 150
    ): Promise<{
        success: boolean;
        results: {
            conversionTime: number;
            layoutTime: number;
            totalTime: number;
            memoryUsage?: number;
        };
        error?: string;
    }> {

        this.logger.info('Running performance benchmark', { nodeCount, edgeCount });

        try {
            // Generate large test data
            const testData = await this.generateLargeTestData(nodeCount, edgeCount);

            const startTime = Date.now();
            const startMemory = process.memoryUsage().heapUsed;

            // Test conversion performance
            const conversionStart = Date.now();
            const conversionResult = await this.testConversion(testData);
            const conversionTime = Date.now() - conversionStart;

            if (!conversionResult.success || !conversionResult.data) {
                throw new Error('Conversion failed during benchmark');
            }

            // Test layout performance
            const layoutStart = Date.now();
            const layoutResult = await this.testLayout(conversionResult.data);
            const layoutTime = Date.now() - layoutStart;

            if (!layoutResult.success) {
                throw new Error('Layout failed during benchmark');
            }

            const totalTime = Date.now() - startTime;
            const endMemory = process.memoryUsage().heapUsed;
            const memoryUsage = endMemory - startMemory;

            return {
                success: true,
                results: {
                    conversionTime,
                    layoutTime,
                    totalTime,
                    memoryUsage
                }
            };

        } catch (error) {
            return {
                success: false,
                results: {
                    conversionTime: 0,
                    layoutTime: 0,
                    totalTime: 0
                },
                error: error instanceof Error ? error.message : 'Unknown benchmark error'
            };
        }
    }

    /**
     * Generate large test data for performance testing
     */
    private async generateLargeTestData(
        nodeCount: number,
        edgeCount: number
    ): Promise<UniversalWorkflowStructure> {

        const nodes: UniversalWorkflowNode[] = [];
        const edges: UniversalWorkflowEdge[] = [];

        // Generate nodes
        for (let i = 0; i < nodeCount; i++) {
            const nodeTypes = ['agent', 'tool_call', 'user_input', 'response'];
            const type = nodeTypes[i % nodeTypes.length];

            nodes.push({
                id: `node-${i}`,
                type,
                position: { x: 0, y: 0 }, // Will be positioned by layout
                data: {
                    label: `${type} ${i}`,
                    description: `Generated ${type} node for performance testing`,
                    metadata: {
                        timestamp: new Date(),
                        index: i,
                        generated: true
                    }
                },
                visualState: {
                    selected: false,
                    draggable: true,
                    hidden: false
                }
            });
        }

        // Generate edges
        for (let i = 0; i < edgeCount && i < nodeCount - 1; i++) {
            const sourceIndex = i;
            const targetIndex = (i + 1) % nodeCount;

            edges.push({
                id: `edge-${i}`,
                source: `node-${sourceIndex}`,
                target: `node-${targetIndex}`,
                type: 'execution',
                data: {
                    label: `Connection ${i}`,
                    description: `Generated edge for performance testing`,
                    metadata: {
                        timestamp: new Date(),
                        index: i,
                        generated: true
                    }
                },
                visualState: {
                    selected: false,
                    hidden: false
                }
            });
        }

        return {
            __workflowType: 'UniversalWorkflowStructure',
            nodes,
            edges,
            metadata: {
                timestamp: new Date(),
                title: 'Performance Test Workflow',
                description: `Large workflow with ${nodeCount} nodes and ${edgeCount} edges`,
                version: '1.0.0',
                creator: 'ReactFlowIntegrationTester',
                tags: ['performance', 'test', 'large']
            },
            layoutConfig: {
                algorithm: 'hierarchical',
                direction: 'TB',
                nodeSpacing: {
                    horizontal: 150,
                    vertical: 100
                }
            }
        };
    }
}

/**
 * Mock logger for silent testing
 */
class MockLogger implements SimpleLogger {
    debug(): void { }
    info(): void { }
    warn(): void { }
    error(): void { }
    log(): void { }
}

/**
 * Convenience function to run a quick integration test
 */
export async function runQuickReactFlowTest(
    config?: ReactFlowTestConfig
): Promise<ReactFlowTestResult> {
    const tester = new ReactFlowIntegrationTester(config);
    return await tester.runIntegrationTest();
}

/**
 * Convenience function to run a performance benchmark
 */
export async function runReactFlowBenchmark(
    nodeCount: number = 100,
    edgeCount: number = 150,
    config?: ReactFlowTestConfig
): Promise<{
    success: boolean;
    results: {
        conversionTime: number;
        layoutTime: number;
        totalTime: number;
        memoryUsage?: number;
    };
    error?: string;
}> {
    const tester = new ReactFlowIntegrationTester(config);
    return await tester.runPerformanceBenchmark(nodeCount, edgeCount);
}