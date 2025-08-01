/**
 * Mermaid Visualization Module Entry Point
 * 
 * Purpose: Exports Mermaid-related functionality for web application
 * Architecture: Separated from agents package for platform-specific rendering
 */

export { RealTimeMermaidGenerator } from './generator';
export type {
    MermaidNodeClassMapping,
    MermaidNodeEmojiMapping,
    MermaidStatusMapping,
    MermaidShapeMapping,
    MermaidArrowMapping,
    MermaidLabelMapping,
    MermaidDiagramConfig,
    MermaidNodeDefinition,
    MermaidEdgeDefinition
} from './types';