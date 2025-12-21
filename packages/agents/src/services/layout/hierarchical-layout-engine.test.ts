/**
 * Hierarchical Layout Engine Tests
 * 
 * Tests for the HierarchicalLayoutEngine implementation.
 */

import { HierarchicalLayoutEngine } from './hierarchical-layout-engine';
import type { 
    UniversalWorkflowNode, 
    UniversalWorkflowEdge, 
    UniversalLayoutConfig 
} from '../workflow-converter/universal-types';
import { SilentLogger } from '../../utils/simple-logger';

describe('HierarchicalLayoutEngine', () => {
    let engine: HierarchicalLayoutEngine;

    function createTestNodes(count: number): UniversalWorkflowNode[] {
        const nodes: UniversalWorkflowNode[] = [];

        for (let i = 0; i < count; i++) {
            nodes.push({
                id: `node-${i}`,
                type: 'test',
                level: Math.floor(i / 2), // 2 nodes per level
                position: {
                    level: Math.floor(i / 2),
                    order: i % 2
                },
                visualState: {
                    status: 'completed',
                    lastUpdated: new Date()
                },
                data: {
                    label: `Node ${i}`
                },
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }

        return nodes;
    }

    function createTestConfig(): UniversalLayoutConfig {
        return {
            algorithm: 'hierarchical',
            direction: 'TB',
            spacing: {
                nodeSpacing: 100,
                levelSpacing: 150
            },
            alignment: {
                horizontal: 'center',
                vertical: 'top'
            }
        };
    }
    
    beforeEach(() => {
        engine = new HierarchicalLayoutEngine(SilentLogger);
    });
    
    afterEach(() => {
        engine.resetStats();
    });
    
    describe('Basic Properties', () => {
        it('should have correct properties', () => {
            expect(engine.name).toBe('HierarchicalLayoutEngine');
            expect(engine.version).toBe('1.0.0');
            expect(engine.algorithm).toBe('hierarchical');
            expect(engine.supportedDirections).toEqual(['TB', 'BT', 'LR', 'RL']);
        });
        
        it('should be enabled by default', () => {
            expect(engine.enabled).toBe(true);
        });
    });
    
    describe('Configuration Validation', () => {
        it('should validate correct configuration', () => {
            const config: UniversalLayoutConfig = {
                algorithm: 'hierarchical',
                direction: 'TB',
                spacing: {
                    nodeSpacing: 100,
                    levelSpacing: 150
                },
                alignment: {
                    horizontal: 'center',
                    vertical: 'top'
                }
            };
            
            const result = engine.validateConfig(config);
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });
        
        it('should reject incorrect algorithm', () => {
            const config: UniversalLayoutConfig = {
                algorithm: 'force',
                direction: 'TB',
                spacing: {
                    nodeSpacing: 100,
                    levelSpacing: 150
                },
                alignment: {
                    horizontal: 'center',
                    vertical: 'top'
                }
            };
            
            const result = engine.validateConfig(config);
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Algorithm must be "hierarchical" for HierarchicalLayoutEngine');
        });
        
        it('should reject unsupported direction', () => {
            const config: UniversalLayoutConfig = {
                algorithm: 'hierarchical',
                direction: 'XY' as any,
                spacing: {
                    nodeSpacing: 100,
                    levelSpacing: 150
                },
                alignment: {
                    horizontal: 'center',
                    vertical: 'top'
                }
            };
            
            const result = engine.validateConfig(config);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(error => error.includes('not supported'))).toBe(true);
        });
        
        it('should warn about small spacing values', () => {
            const config: UniversalLayoutConfig = {
                algorithm: 'hierarchical',
                direction: 'TB',
                spacing: {
                    nodeSpacing: 50,
                    levelSpacing: 80
                },
                alignment: {
                    horizontal: 'center',
                    vertical: 'top'
                }
            };
            
            const result = engine.validateConfig(config);
            expect(result.warnings.length).toBeGreaterThan(0);
        });
    });
    
    describe('Layout Calculation', () => {
        it('should calculate layout for empty node list', async () => {
            const nodes: UniversalWorkflowNode[] = [];
            const edges: UniversalWorkflowEdge[] = [];
            const config = createTestConfig();
            
            const result = await engine.calculateLayout(nodes, edges, config);
            
            expect(result.success).toBe(true);
            expect(result.nodes).toHaveLength(0);
            expect(result.errors).toHaveLength(0);
        });
        
        it('should calculate layout for single node', async () => {
            const nodes = createTestNodes(1);
            const edges: UniversalWorkflowEdge[] = [];
            const config = createTestConfig();
            
            const result = await engine.calculateLayout(nodes, edges, config);
            
            expect(result.success).toBe(true);
            expect(result.nodes).toHaveLength(1);
            expect(result.nodes[0].position.x).toBe(0); // Centered
            expect(result.nodes[0].position.y).toBe(0); // Top level
        });
        
        it('should calculate layout for multiple nodes', async () => {
            const nodes = createTestNodes(4); // 2 levels, 2 nodes each
            const edges: UniversalWorkflowEdge[] = [];
            const config = createTestConfig();
            
            const result = await engine.calculateLayout(nodes, edges, config);
            
            expect(result.success).toBe(true);
            expect(result.nodes).toHaveLength(4);
            
            // Check that nodes are positioned correctly
            const level0Nodes = result.nodes.filter(n => n.level === 0);
            const level1Nodes = result.nodes.filter(n => n.level === 1);
            
            expect(level0Nodes).toHaveLength(2);
            expect(level1Nodes).toHaveLength(2);
            
            // Level 1 should be below level 0
            expect(level1Nodes[0].position.y).toBeGreaterThan(level0Nodes[0].position.y!);
        });
        
        it('should apply direction transformation correctly', async () => {
            const nodes = createTestNodes(2);
            const edges: UniversalWorkflowEdge[] = [];
            
            // Test Bottom-to-Top direction
            const configBT: UniversalLayoutConfig = {
                ...createTestConfig(),
                direction: 'BT'
            };
            
            const resultBT = await engine.calculateLayout(nodes, edges, configBT);
            
            expect(resultBT.success).toBe(true);
            expect(resultBT.nodes).toHaveLength(2);
            
            // In BT layout, higher levels should have negative Y coordinates
            const level0Node = resultBT.nodes.find(n => n.level === 0);
            const level1Node = resultBT.nodes.find(n => n.level === 1);
            
            expect(level0Node?.position.y).toBeGreaterThanOrEqual(0);
            expect(level1Node?.position.y).toBeLessThanOrEqual(0);
        });
        
        it('should calculate bounds correctly', async () => {
            const nodes = createTestNodes(4);
            const edges: UniversalWorkflowEdge[] = [];
            const config = createTestConfig();
            
            const result = await engine.calculateLayout(nodes, edges, config);
            
            expect(result.success).toBe(true);
            expect(result.metadata.bounds).toBeDefined();
            expect(result.metadata.bounds.width).toBeGreaterThan(0);
            expect(result.metadata.bounds.height).toBeGreaterThan(0);
        });
        
        it('should constrain to bounds when provided', async () => {
            const nodes = createTestNodes(6);
            const edges: UniversalWorkflowEdge[] = [];
            const config = createTestConfig();
            
            const options = {
                bounds: {
                    width: 500,
                    height: 400,
                    padding: 50
                }
            };
            
            const result = await engine.calculateLayout(nodes, edges, config, options);
            
            expect(result.success).toBe(true);
            
            // Check that all nodes are within bounds
            for (const node of result.nodes) {
                expect(node.position.x).toBeGreaterThanOrEqual(0);
                expect(node.position.x).toBeLessThanOrEqual(options.bounds.width);
                expect(node.position.y).toBeGreaterThanOrEqual(0);
                expect(node.position.y).toBeLessThanOrEqual(options.bounds.height);
            }
        });
    });
    
    describe('Configuration Support', () => {
        it('should support hierarchical algorithm', () => {
            const config: UniversalLayoutConfig = {
                algorithm: 'hierarchical',
                direction: 'TB',
                spacing: { nodeSpacing: 100, levelSpacing: 150 },
                alignment: { horizontal: 'center', vertical: 'top' }
            };
            
            expect(engine.supportsConfig(config)).toBe(true);
        });
        
        it('should not support other algorithms', () => {
            const config: UniversalLayoutConfig = {
                algorithm: 'force',
                direction: 'TB',
                spacing: { nodeSpacing: 100, levelSpacing: 150 },
                alignment: { horizontal: 'center', vertical: 'top' }
            };
            
            expect(engine.supportsConfig(config)).toBe(false);
        });
    });
    
    describe('Optimal Configuration', () => {
        it('should generate optimal config for small node count', () => {
            const nodes = createTestNodes(5);
            const edges: UniversalWorkflowEdge[] = [];
            
            const config = engine.getOptimalConfig(nodes, edges);
            
            expect(config.algorithm).toBe('hierarchical');
            expect(config.spacing.nodeSpacing).toBeGreaterThan(0);
            expect(config.spacing.levelSpacing).toBeGreaterThan(0);
        });
        
        it('should generate optimal config for large node count', () => {
            const nodes = createTestNodes(50);
            const edges: UniversalWorkflowEdge[] = [];
            
            const config = engine.getOptimalConfig(nodes, edges);
            
            expect(config.algorithm).toBe('hierarchical');
            // Should use tighter spacing for many nodes
            expect(config.spacing.nodeSpacing).toBeLessThan(120);
        });
    });
    
    describe('Statistics', () => {
        it('should track calculation statistics', async () => {
            const nodes = createTestNodes(3);
            const edges: UniversalWorkflowEdge[] = [];
            const config = createTestConfig();
            
            const initialStats = engine.getStats();
            expect(initialStats.totalCalculations).toBe(0);
            
            await engine.calculateLayout(nodes, edges, config);
            
            const updatedStats = engine.getStats();
            expect(updatedStats.totalCalculations).toBe(1);
            expect(updatedStats.successfulCalculations).toBe(1);
            expect(updatedStats.averageProcessingTime).toBeGreaterThan(0);
        });
        
        it('should reset statistics', async () => {
            const nodes = createTestNodes(2);
            const edges: UniversalWorkflowEdge[] = [];
            const config = createTestConfig();
            
            await engine.calculateLayout(nodes, edges, config);
            
            let stats = engine.getStats();
            expect(stats.totalCalculations).toBe(1);
            
            engine.resetStats();
            
            stats = engine.getStats();
            expect(stats.totalCalculations).toBe(0);
        });
    });
    
    describe('Error Handling', () => {
        it('should handle disabled engine', async () => {
            engine.enabled = false;
            
            const nodes = createTestNodes(1);
            const edges: UniversalWorkflowEdge[] = [];
            const config = createTestConfig();
            
            await expect(engine.calculateLayout(nodes, edges, config))
                .rejects.toThrow('Layout engine HierarchicalLayoutEngine is disabled');
        });
        
        it('should handle invalid configuration', async () => {
            const nodes = createTestNodes(1);
            const edges: UniversalWorkflowEdge[] = [];
            const config: UniversalLayoutConfig = {
                algorithm: 'force', // Invalid for this engine
                direction: 'TB',
                spacing: { nodeSpacing: 100, levelSpacing: 150 },
                alignment: { horizontal: 'center', vertical: 'top' }
            };
            
            const result = await engine.calculateLayout(nodes, edges, config);
            
            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });
});