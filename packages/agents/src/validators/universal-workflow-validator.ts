/**
 * Universal Workflow Validator
 * 
 * Validates UniversalWorkflowStructure data for correctness and integrity.
 * Implements comprehensive validation rules for universal workflow format.
 */

import { BaseWorkflowValidator } from '../abstracts/base-workflow-validator';
import type { UniversalWorkflowStructure } from '../services/workflow-converter/universal-types';
import type { WorkflowData } from '../interfaces/workflow-converter';
import type {
    ValidationOptions,
    ValidationIssue
} from '../interfaces/workflow-validator';
import { ValidationSeverity } from '../interfaces/workflow-validator';
import { SimpleLogger, SilentLogger } from '../utils/simple-logger';

/**
 * Available validation rules for Universal Workflow
 */
export const UNIVERSAL_WORKFLOW_VALIDATION_RULES = {
    STRUCTURE_INTEGRITY: 'structure-integrity',
    NODE_VALIDITY: 'node-validity',
    EDGE_VALIDITY: 'edge-validity',
    ID_UNIQUENESS: 'id-uniqueness',
    REFERENCE_INTEGRITY: 'reference-integrity',
    CIRCULAR_REFERENCES: 'circular-references',
    POSITION_VALIDITY: 'position-validity',
    LAYOUT_CONSISTENCY: 'layout-consistency',
    METADATA_COMPLETENESS: 'metadata-completeness',
    DIMENSION_VALIDITY: 'dimension-validity'
} as const;

/**
 * Universal Workflow Validator
 * 
 * Provides comprehensive validation for UniversalWorkflowStructure:
 * - Structure integrity checking
 * - Node and edge validation
 * - Reference integrity verification
 * - Circular reference detection
 * - Position and layout validation
 * - Metadata completeness checking
 */
export class UniversalWorkflowValidator extends BaseWorkflowValidator<UniversalWorkflowStructure> {
    readonly name = 'UniversalWorkflowValidator';
    readonly version = '1.0.0';
    readonly dataFormat = 'universal-workflow';
    readonly availableRules = Object.values(UNIVERSAL_WORKFLOW_VALIDATION_RULES);

    /**
     * Constructor with dependency injection
     * 
     * @param logger - Logger instance (optional, defaults to SilentLogger)
     */
    constructor(logger?: SimpleLogger) {
        super({
            logger: logger || SilentLogger,
            enabled: true,
            defaultOptions: {
                strict: false,
                includeWarnings: true,
                includeInfo: false,
                maxErrors: 50
            }
        });
    }

    /**
     * Initialize validation rule configurations
     */
    protected initializeRuleConfigs(): void {
        // Structure integrity rules
        this.ruleConfigs.set(UNIVERSAL_WORKFLOW_VALIDATION_RULES.STRUCTURE_INTEGRITY, {
            enabled: true,
            description: 'Validates basic workflow structure integrity',
            severity: ValidationSeverity.ERROR,
            category: 'structure'
        });

        // Node validation rules
        this.ruleConfigs.set(UNIVERSAL_WORKFLOW_VALIDATION_RULES.NODE_VALIDITY, {
            enabled: true,
            description: 'Validates individual node properties and structure',
            severity: ValidationSeverity.ERROR,
            category: 'nodes'
        });

        // Edge validation rules
        this.ruleConfigs.set(UNIVERSAL_WORKFLOW_VALIDATION_RULES.EDGE_VALIDITY, {
            enabled: true,
            description: 'Validates individual edge properties and structure',
            severity: ValidationSeverity.ERROR,
            category: 'edges'
        });

        // ID uniqueness rules
        this.ruleConfigs.set(UNIVERSAL_WORKFLOW_VALIDATION_RULES.ID_UNIQUENESS, {
            enabled: true,
            description: 'Ensures all node and edge IDs are unique',
            severity: ValidationSeverity.ERROR,
            category: 'integrity'
        });

        // Reference integrity rules
        this.ruleConfigs.set(UNIVERSAL_WORKFLOW_VALIDATION_RULES.REFERENCE_INTEGRITY, {
            enabled: true,
            description: 'Validates that all references point to existing entities',
            severity: ValidationSeverity.ERROR,
            category: 'integrity'
        });

        // Circular reference detection
        this.ruleConfigs.set(UNIVERSAL_WORKFLOW_VALIDATION_RULES.CIRCULAR_REFERENCES, {
            enabled: true,
            description: 'Detects circular references that could cause infinite loops',
            severity: ValidationSeverity.ERROR,
            category: 'integrity'
        });

        // Position validation
        this.ruleConfigs.set(UNIVERSAL_WORKFLOW_VALIDATION_RULES.POSITION_VALIDITY, {
            enabled: true,
            description: 'Validates node position properties',
            severity: ValidationSeverity.WARNING,
            category: 'layout'
        });

        // Layout consistency
        this.ruleConfigs.set(UNIVERSAL_WORKFLOW_VALIDATION_RULES.LAYOUT_CONSISTENCY, {
            enabled: true,
            description: 'Validates layout configuration consistency',
            severity: ValidationSeverity.WARNING,
            category: 'layout'
        });

        // Metadata completeness
        this.ruleConfigs.set(UNIVERSAL_WORKFLOW_VALIDATION_RULES.METADATA_COMPLETENESS, {
            enabled: false, // Optional by default
            description: 'Validates metadata completeness and consistency',
            severity: ValidationSeverity.INFO,
            category: 'metadata'
        });

        // Dimension validity
        this.ruleConfigs.set(UNIVERSAL_WORKFLOW_VALIDATION_RULES.DIMENSION_VALIDITY, {
            enabled: true,
            description: 'Validates node dimension properties',
            severity: ValidationSeverity.WARNING,
            category: 'layout'
        });
    }

    /**
     * Perform validation for a specific rule
     */
    protected async performRuleValidation(
        data: UniversalWorkflowStructure,
        rule: string,
        _options: ValidationOptions
    ): Promise<{ issues: ValidationIssue[] }> {
        const issues: ValidationIssue[] = [];

        switch (rule) {
            case UNIVERSAL_WORKFLOW_VALIDATION_RULES.STRUCTURE_INTEGRITY:
                issues.push(...await this.validateStructureIntegrity(data));
                break;

            case UNIVERSAL_WORKFLOW_VALIDATION_RULES.NODE_VALIDITY:
                issues.push(...await this.validateNodes(data));
                break;

            case UNIVERSAL_WORKFLOW_VALIDATION_RULES.EDGE_VALIDITY:
                issues.push(...await this.validateEdges(data));
                break;

            case UNIVERSAL_WORKFLOW_VALIDATION_RULES.ID_UNIQUENESS:
                issues.push(...await this.validateIdUniqueness(data));
                break;

            case UNIVERSAL_WORKFLOW_VALIDATION_RULES.REFERENCE_INTEGRITY:
                issues.push(...await this.validateReferenceIntegrity(data));
                break;

            case UNIVERSAL_WORKFLOW_VALIDATION_RULES.CIRCULAR_REFERENCES:
                issues.push(...await this.validateCircularReferences(data));
                break;

            case UNIVERSAL_WORKFLOW_VALIDATION_RULES.POSITION_VALIDITY:
                issues.push(...await this.validatePositions(data));
                break;

            case UNIVERSAL_WORKFLOW_VALIDATION_RULES.LAYOUT_CONSISTENCY:
                issues.push(...await this.validateLayoutConsistency(data));
                break;

            case UNIVERSAL_WORKFLOW_VALIDATION_RULES.METADATA_COMPLETENESS:
                issues.push(...await this.validateMetadataCompleteness(data));
                break;

            case UNIVERSAL_WORKFLOW_VALIDATION_RULES.DIMENSION_VALIDITY:
                issues.push(...await this.validateDimensions(data));
                break;

            default:
                issues.push(this.createIssue(
                    ValidationSeverity.ERROR,
                    `Unknown validation rule: ${rule}`,
                    rule,
                    `validator-error-${rule}`
                ));
        }

        return { issues };
    }

    /**
     * Validate basic structure integrity
     */
    private async validateStructureIntegrity(data: UniversalWorkflowStructure): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        // Check required fields
        if (!data.id) {
            issues.push(this.createIssue(
                ValidationSeverity.ERROR,
                'Workflow must have an ID',
                UNIVERSAL_WORKFLOW_VALIDATION_RULES.STRUCTURE_INTEGRITY,
                'missing-workflow-id'
            ));
        }

        if (!Array.isArray(data.nodes)) {
            issues.push(this.createIssue(
                ValidationSeverity.ERROR,
                'Workflow must have a nodes array',
                UNIVERSAL_WORKFLOW_VALIDATION_RULES.STRUCTURE_INTEGRITY,
                'invalid-nodes-array'
            ));
        }

        if (!Array.isArray(data.edges)) {
            issues.push(this.createIssue(
                ValidationSeverity.ERROR,
                'Workflow must have an edges array',
                UNIVERSAL_WORKFLOW_VALIDATION_RULES.STRUCTURE_INTEGRITY,
                'invalid-edges-array'
            ));
        }

        if (!data.layout) {
            issues.push(this.createIssue(
                ValidationSeverity.ERROR,
                'Workflow must have layout configuration',
                UNIVERSAL_WORKFLOW_VALIDATION_RULES.STRUCTURE_INTEGRITY,
                'missing-layout-config'
            ));
        }

        if (!data.metadata) {
            issues.push(this.createIssue(
                ValidationSeverity.WARNING,
                'Workflow should have metadata',
                UNIVERSAL_WORKFLOW_VALIDATION_RULES.STRUCTURE_INTEGRITY,
                'missing-metadata'
            ));
        }

        return issues;
    }

    /**
     * Validate individual nodes
     */
    private async validateNodes(data: UniversalWorkflowStructure): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        if (!Array.isArray(data.nodes)) {
            return issues; // Already handled in structure integrity
        }

        for (let i = 0; i < data.nodes.length; i++) {
            const node = data.nodes[i];
            const context = { nodeId: node?.id || `node-${i}` };

            // Check required node fields
            if (!node.id) {
                issues.push(this.createIssue(
                    ValidationSeverity.ERROR,
                    `Node at index ${i} is missing ID`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.NODE_VALIDITY,
                    `node-missing-id-${i}`,
                    context
                ));
            }

            if (!node.type) {
                issues.push(this.createIssue(
                    ValidationSeverity.ERROR,
                    `Node ${node.id} is missing type`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.NODE_VALIDITY,
                    `node-missing-type-${node.id}`,
                    context
                ));
            }

            if (typeof node.level !== 'number') {
                issues.push(this.createIssue(
                    ValidationSeverity.ERROR,
                    `Node ${node.id} must have a numeric level`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.NODE_VALIDITY,
                    `node-invalid-level-${node.id}`,
                    context
                ));
            }

            if (!node.position) {
                issues.push(this.createIssue(
                    ValidationSeverity.ERROR,
                    `Node ${node.id} is missing position information`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.NODE_VALIDITY,
                    `node-missing-position-${node.id}`,
                    context
                ));
            }

            if (!node.visualState) {
                issues.push(this.createIssue(
                    ValidationSeverity.ERROR,
                    `Node ${node.id} is missing visual state`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.NODE_VALIDITY,
                    `node-missing-visual-state-${node.id}`,
                    context
                ));
            }

            if (!node.data || !node.data.label) {
                issues.push(this.createIssue(
                    ValidationSeverity.WARNING,
                    `Node ${node.id} should have a label`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.NODE_VALIDITY,
                    `node-missing-label-${node.id}`,
                    context
                ));
            }
        }

        return issues;
    }

    /**
     * Validate individual edges
     */
    private async validateEdges(data: UniversalWorkflowStructure): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        if (!Array.isArray(data.edges)) {
            return issues; // Already handled in structure integrity
        }

        for (let i = 0; i < data.edges.length; i++) {
            const edge = data.edges[i];
            const context = { edgeId: edge?.id || `edge-${i}` };

            // Check required edge fields
            if (!edge.id) {
                issues.push(this.createIssue(
                    ValidationSeverity.ERROR,
                    `Edge at index ${i} is missing ID`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.EDGE_VALIDITY,
                    `edge-missing-id-${i}`,
                    context
                ));
            }

            if (!edge.source) {
                issues.push(this.createIssue(
                    ValidationSeverity.ERROR,
                    `Edge ${edge.id} is missing source node ID`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.EDGE_VALIDITY,
                    `edge-missing-source-${edge.id}`,
                    context
                ));
            }

            if (!edge.target) {
                issues.push(this.createIssue(
                    ValidationSeverity.ERROR,
                    `Edge ${edge.id} is missing target node ID`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.EDGE_VALIDITY,
                    `edge-missing-target-${edge.id}`,
                    context
                ));
            }

            if (!edge.type) {
                issues.push(this.createIssue(
                    ValidationSeverity.WARNING,
                    `Edge ${edge.id} should have a type`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.EDGE_VALIDITY,
                    `edge-missing-type-${edge.id}`,
                    context
                ));
            }

            // Check for self-referencing edges
            if (edge.source === edge.target) {
                issues.push(this.createIssue(
                    ValidationSeverity.WARNING,
                    `Edge ${edge.id} connects a node to itself`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.EDGE_VALIDITY,
                    `edge-self-reference-${edge.id}`,
                    context
                ));
            }
        }

        return issues;
    }

    /**
     * Validate ID uniqueness
     */
    private async validateIdUniqueness(data: UniversalWorkflowStructure): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];
        const seenIds = new Set<string>();

        // Check node ID uniqueness
        if (Array.isArray(data.nodes)) {
            for (const node of data.nodes) {
                if (node.id) {
                    if (seenIds.has(node.id)) {
                        issues.push(this.createIssue(
                            ValidationSeverity.ERROR,
                            `Duplicate node ID: ${node.id}`,
                            UNIVERSAL_WORKFLOW_VALIDATION_RULES.ID_UNIQUENESS,
                            `duplicate-node-id-${node.id}`,
                            { nodeId: node.id }
                        ));
                    } else {
                        seenIds.add(node.id);
                    }
                }
            }
        }

        // Check edge ID uniqueness
        if (Array.isArray(data.edges)) {
            for (const edge of data.edges) {
                if (edge.id) {
                    if (seenIds.has(edge.id)) {
                        issues.push(this.createIssue(
                            ValidationSeverity.ERROR,
                            `Duplicate edge ID: ${edge.id}`,
                            UNIVERSAL_WORKFLOW_VALIDATION_RULES.ID_UNIQUENESS,
                            `duplicate-edge-id-${edge.id}`,
                            { edgeId: edge.id }
                        ));
                    } else {
                        seenIds.add(edge.id);
                    }
                }
            }
        }

        return issues;
    }

    /**
     * Validate reference integrity
     */
    private async validateReferenceIntegrity(data: UniversalWorkflowStructure): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
            return issues;
        }

        // Build set of valid node IDs
        const nodeIds = new Set(data.nodes.map(node => node.id).filter(id => id));

        // Check edge references
        for (const edge of data.edges) {
            if (edge.source && !nodeIds.has(edge.source)) {
                issues.push(this.createIssue(
                    ValidationSeverity.ERROR,
                    `Edge ${edge.id} references unknown source node: ${edge.source}`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.REFERENCE_INTEGRITY,
                    `edge-invalid-source-${edge.id}`,
                    { edgeId: edge.id }
                ));
            }

            if (edge.target && !nodeIds.has(edge.target)) {
                issues.push(this.createIssue(
                    ValidationSeverity.ERROR,
                    `Edge ${edge.id} references unknown target node: ${edge.target}`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.REFERENCE_INTEGRITY,
                    `edge-invalid-target-${edge.id}`,
                    { edgeId: edge.id }
                ));
            }
        }

        // Check parent node references
        for (const node of data.nodes) {
            if (node.parentId && !nodeIds.has(node.parentId)) {
                issues.push(this.createIssue(
                    ValidationSeverity.ERROR,
                    `Node ${node.id} references unknown parent node: ${node.parentId}`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.REFERENCE_INTEGRITY,
                    `node-invalid-parent-${node.id}`,
                    { nodeId: node.id }
                ));
            }
        }

        return issues;
    }

    /**
     * Validate circular references
     */
    private async validateCircularReferences(data: UniversalWorkflowStructure): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
            return issues;
        }

        // Build adjacency list from edges
        const adjacencyList = new Map<string, string[]>();

        for (const edge of data.edges) {
            if (edge.source && edge.target) {
                if (!adjacencyList.has(edge.source)) {
                    adjacencyList.set(edge.source, []);
                }
                adjacencyList.get(edge.source)!.push(edge.target);
            }
        }

        // Check for cycles using DFS
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const hasCycle = (nodeId: string): boolean => {
            if (recursionStack.has(nodeId)) {
                return true; // Cycle detected
            }

            if (visited.has(nodeId)) {
                return false; // Already processed
            }

            visited.add(nodeId);
            recursionStack.add(nodeId);

            const neighbors = adjacencyList.get(nodeId) || [];
            for (const neighbor of neighbors) {
                if (hasCycle(neighbor)) {
                    return true;
                }
            }

            recursionStack.delete(nodeId);
            return false;
        };

        // Check each node for cycles
        for (const node of data.nodes) {
            if (node.id && !visited.has(node.id)) {
                if (hasCycle(node.id)) {
                    issues.push(this.createIssue(
                        ValidationSeverity.ERROR,
                        `Circular reference detected starting from node: ${node.id}`,
                        UNIVERSAL_WORKFLOW_VALIDATION_RULES.CIRCULAR_REFERENCES,
                        `circular-reference-${node.id}`,
                        { nodeId: node.id }
                    ));
                }
            }
        }

        return issues;
    }

    /**
     * Validate node positions
     */
    private async validatePositions(data: UniversalWorkflowStructure): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        if (!Array.isArray(data.nodes)) {
            return issues;
        }

        for (const node of data.nodes) {
            if (!node.position) {
                continue; // Already handled in node validity
            }

            const pos = node.position;

            // Check for negative levels
            if (pos.level < 0) {
                issues.push(this.createIssue(
                    ValidationSeverity.WARNING,
                    `Node ${node.id} has negative level: ${pos.level}`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.POSITION_VALIDITY,
                    `node-negative-level-${node.id}`,
                    { nodeId: node.id }
                ));
            }

            // Check for invalid coordinates if defined
            if (typeof pos.x === 'number' && !isFinite(pos.x)) {
                issues.push(this.createIssue(
                    ValidationSeverity.WARNING,
                    `Node ${node.id} has invalid X coordinate: ${pos.x}`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.POSITION_VALIDITY,
                    `node-invalid-x-${node.id}`,
                    { nodeId: node.id }
                ));
            }

            if (typeof pos.y === 'number' && !isFinite(pos.y)) {
                issues.push(this.createIssue(
                    ValidationSeverity.WARNING,
                    `Node ${node.id} has invalid Y coordinate: ${pos.y}`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.POSITION_VALIDITY,
                    `node-invalid-y-${node.id}`,
                    { nodeId: node.id }
                ));
            }
        }

        return issues;
    }

    /**
     * Validate layout consistency
     */
    private async validateLayoutConsistency(data: UniversalWorkflowStructure): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        if (!data.layout) {
            return issues; // Already handled in structure integrity
        }

        const layout = data.layout;

        // Check algorithm validity
        const validAlgorithms = ['hierarchical', 'force', 'grid', 'circular', 'manual'];
        if (!validAlgorithms.includes(layout.algorithm)) {
            issues.push(this.createIssue(
                ValidationSeverity.WARNING,
                `Unknown layout algorithm: ${layout.algorithm}`,
                UNIVERSAL_WORKFLOW_VALIDATION_RULES.LAYOUT_CONSISTENCY,
                `layout-unknown-algorithm-${layout.algorithm}`
            ));
        }

        // Check direction validity
        const validDirections = ['TB', 'BT', 'LR', 'RL'];
        if (!validDirections.includes(layout.direction)) {
            issues.push(this.createIssue(
                ValidationSeverity.WARNING,
                `Invalid layout direction: ${layout.direction}`,
                UNIVERSAL_WORKFLOW_VALIDATION_RULES.LAYOUT_CONSISTENCY,
                `layout-invalid-direction-${layout.direction}`
            ));
        }

        // Check spacing values
        if (layout.spacing) {
            if (layout.spacing.nodeSpacing < 0) {
                issues.push(this.createIssue(
                    ValidationSeverity.WARNING,
                    `Negative node spacing: ${layout.spacing.nodeSpacing}`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.LAYOUT_CONSISTENCY,
                    'layout-negative-node-spacing'
                ));
            }

            if (layout.spacing.levelSpacing < 0) {
                issues.push(this.createIssue(
                    ValidationSeverity.WARNING,
                    `Negative level spacing: ${layout.spacing.levelSpacing}`,
                    UNIVERSAL_WORKFLOW_VALIDATION_RULES.LAYOUT_CONSISTENCY,
                    'layout-negative-level-spacing'
                ));
            }
        }

        return issues;
    }

    /**
     * Validate metadata completeness
     */
    private async validateMetadataCompleteness(data: UniversalWorkflowStructure): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        if (!data.metadata) {
            return issues; // Already handled in structure integrity
        }

        const metadata = data.metadata;

        if (!metadata.createdAt) {
            issues.push(this.createIssue(
                ValidationSeverity.INFO,
                'Workflow metadata should include creation timestamp',
                UNIVERSAL_WORKFLOW_VALIDATION_RULES.METADATA_COMPLETENESS,
                'metadata-missing-created-at'
            ));
        }

        if (!metadata.updatedAt) {
            issues.push(this.createIssue(
                ValidationSeverity.INFO,
                'Workflow metadata should include update timestamp',
                UNIVERSAL_WORKFLOW_VALIDATION_RULES.METADATA_COMPLETENESS,
                'metadata-missing-updated-at'
            ));
        }

        if (!metadata.metrics) {
            issues.push(this.createIssue(
                ValidationSeverity.INFO,
                'Workflow metadata should include metrics',
                UNIVERSAL_WORKFLOW_VALIDATION_RULES.METADATA_COMPLETENESS,
                'metadata-missing-metrics'
            ));
        }

        return issues;
    }

    /**
     * Validate node dimensions
     */
    private async validateDimensions(data: UniversalWorkflowStructure): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        if (!Array.isArray(data.nodes)) {
            return issues;
        }

        for (const node of data.nodes) {
            if (node.dimensions) {
                const dims = node.dimensions;

                if (typeof dims.width === 'number' && dims.width <= 0) {
                    issues.push(this.createIssue(
                        ValidationSeverity.WARNING,
                        `Node ${node.id} has invalid width: ${dims.width}`,
                        UNIVERSAL_WORKFLOW_VALIDATION_RULES.DIMENSION_VALIDITY,
                        `node-invalid-width-${node.id}`,
                        { nodeId: node.id }
                    ));
                }

                if (typeof dims.height === 'number' && dims.height <= 0) {
                    issues.push(this.createIssue(
                        ValidationSeverity.WARNING,
                        `Node ${node.id} has invalid height: ${dims.height}`,
                        UNIVERSAL_WORKFLOW_VALIDATION_RULES.DIMENSION_VALIDITY,
                        `node-invalid-height-${node.id}`,
                        { nodeId: node.id }
                    ));
                }
            }
        }

        return issues;
    }

    /**
     * Helper method to create validation issues
     */
    private createIssue(
        severity: ValidationSeverity,
        message: string,
        rule: string,
        id: string,
        location?: Record<string, unknown>
    ): ValidationIssue {
        return {
            id,
            severity,
            message,
            rule,
            location,
            detectedAt: new Date()
        };
    }

    /**
     * Enhanced type checking for UniversalWorkflowStructure
     */
    override canValidate(data: WorkflowData): data is UniversalWorkflowStructure {
        if (!data || typeof data !== 'object') {
            return false;
        }

        const obj = data;

        // Check for UniversalWorkflowStructure signature
        return (
            typeof obj.id === 'string' &&
            (Array.isArray(obj.nodes) || obj.nodes === undefined) &&
            (Array.isArray(obj.edges) || obj.edges === undefined) &&
            (typeof obj.layout === 'object' || obj.layout === undefined) &&
            (typeof obj.metadata === 'object' || obj.metadata === undefined)
        );
    }
}