/**
 * Mermaid Generator Types for Web Application
 * 
 * Purpose: Local type definitions for Mermaid diagram generation services in web context.
 * Architecture: Separated from agents package to maintain domain neutrality.
 * Features: Platform-specific Mermaid rendering configurations and mappings.
 */

/**
 * Mermaid-specific mapping types for diagram generation
 */
export type MermaidNodeClassMapping = Record<string, string>;
export type MermaidNodeEmojiMapping = Record<string, string>;
export type MermaidStatusMapping = Record<string, string>;
export type MermaidShapeMapping = Record<string, { start: string; end: string }>;
export type MermaidArrowMapping = Record<string, string>;
export type MermaidLabelMapping = Record<string, string>;

/**
 * Mermaid diagram configuration
 */
export interface MermaidDiagramConfig {
    direction: 'TB' | 'BT' | 'LR' | 'RL';
    theme?: string;
    fontSize?: number;
    nodeSpacing?: number;
    rankSpacing?: number;
}

/**
 * Mermaid node representation
 */
export interface MermaidNodeDefinition {
    id: string;
    label: string;
    className?: string;
    shape: { start: string; end: string };
    emoji?: string;
}

/**
 * Mermaid edge representation
 */
export interface MermaidEdgeDefinition {
    from: string;
    to: string;
    label?: string;
    arrow: string;
    className?: string;
}