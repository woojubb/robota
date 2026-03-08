import type { ITool, TToolParameters } from './tool';

/**
 * Execution step definition for tools that support step-by-step progress reporting
 */
export interface IToolExecutionStep {
    /** Unique identifier for this step */
    id: string;

    /** Human-readable name of the step */
    name: string;

    /** Tool-provided estimated duration for this step in milliseconds */
    estimatedDuration: number;

    /** Optional description of what this step does */
    description?: string;
}

/**
 * Progress callback function type for real-time progress updates
 */
export type TToolProgressCallback = (step: string, progress: number) => void;

/**
 * 🆕 IProgressReportingTool - Optional interface for tools that can provide their own progress information
 * 
 * This interface extends the standard ITool to allow tools to optionally provide:
 * - Estimated execution duration
 * - Step-by-step execution plans
 * - Real-time progress callbacks
 * 
 * Benefits:
 * - Tools can provide accurate progress information based on their internal knowledge
 * - No simulation or fake progress - only real tool-provided estimates
 * - Completely optional - existing tools work unchanged
 * - Tools can self-report progress for better user experience
 */
export interface IProgressReportingTool extends ITool {
    /**
     * Get estimated execution duration for given parameters (optional)
     * 
     * Tools can implement this to provide accurate time estimates based on:
     * - Parameter complexity (e.g., search query length, file size)
     * - Historical execution data
     * - Internal optimization knowledge
     * 
     * @param parameters - The parameters that will be passed to execute()
     * @returns Estimated duration in milliseconds, or undefined if not available
     */
    getEstimatedDuration?(parameters: TToolParameters): number;

    /**
     * Get execution steps for given parameters (optional)
     * 
     * Tools can implement this to provide step-by-step execution plans:
     * - webSearch: [query processing, API call, result parsing, filtering]
     * - fileSearch: [file scanning, content reading, pattern matching, result formatting]
     * - github-mcp: [authentication, API request, response processing, data transformation]
     * 
     * @param parameters - The parameters that will be passed to execute()
     * @returns Array of execution steps, or undefined if not available
     */
    getExecutionSteps?(parameters: TToolParameters): IToolExecutionStep[];

    /**
     * Set progress callback for real-time updates (optional)
     * 
     * Tools can implement this to provide real-time progress updates during execution:
     * - Called when each step starts/completes
     * - Progress value between 0-100 representing completion percentage
     * - Step name helps users understand what's currently happening
     * 
     * @param callback - Function to call with progress updates
     */
    setProgressCallback?(callback: TToolProgressCallback): void;
}

/**
 * Type guard to check if a tool implements progress reporting
 */
export function isProgressReportingTool(tool: ITool): tool is IProgressReportingTool {
    return (
        'getEstimatedDuration' in tool ||
        'getExecutionSteps' in tool ||
        'setProgressCallback' in tool
    );
}

/**
 * Helper function to safely get estimated duration from any tool
 */
export function getToolEstimatedDuration(tool: ITool, parameters: TToolParameters): number | undefined {
    if (isProgressReportingTool(tool) && tool.getEstimatedDuration) {
        return tool.getEstimatedDuration(parameters);
    }
    return undefined;
}

/**
 * Helper function to safely get execution steps from any tool
 */
export function getToolExecutionSteps(tool: ITool, parameters: TToolParameters): IToolExecutionStep[] | undefined {
    if (isProgressReportingTool(tool) && tool.getExecutionSteps) {
        return tool.getExecutionSteps(parameters);
    }
    return undefined;
}

/**
 * Helper function to safely set progress callback on any tool
 */
export function setToolProgressCallback(tool: ITool, callback: TToolProgressCallback): boolean {
    if (isProgressReportingTool(tool) && tool.setProgressCallback) {
        tool.setProgressCallback(callback);
        return true;
    }
    return false;
} 