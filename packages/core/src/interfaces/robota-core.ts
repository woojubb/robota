import type { RunOptions } from '../types';
import type { StreamingResponseChunk } from './ai-provider';

/**
 * Core execution interface for Robota
 * Contains only essential execution methods
 * 
 * @public
 */
export interface RobotaCore {
    /**
     * Execute AI conversation with prompt
     * 
     * @param prompt - User input text
     * @param options - Optional run configuration
     * @returns Promise resolving to AI response text
     */
    run(prompt: string, options?: RunOptions): Promise<string>;

    /**
     * Execute AI conversation with streaming response
     * 
     * @param prompt - User input text  
     * @param options - Optional run configuration
     * @returns Promise resolving to async iterable of response chunks
     */
    runStream(prompt: string, options?: RunOptions): Promise<AsyncIterable<StreamingResponseChunk>>;

    /**
     * Release all resources and close connections
     * 
     * @returns Promise that resolves when cleanup is complete
     */
    close(): Promise<void>;
}

/**
 * Configuration interface for Robota
 * Contains configuration and management methods
 * 
 * @public
 */
export interface RobotaConfigurable {
    /**
     * Call a specific tool directly
     * 
     * @param toolName - Name of the tool to call
     * @param parameters - Parameters to pass to the tool
     * @returns Promise resolving to the tool's result
     */
    callTool(toolName: string, parameters: Record<string, any>): Promise<any>;

    /**
     * Get list of all available tools
     * 
     * @returns Array of tool metadata objects
     */
    getAvailableTools(): any[];

    /**
     * Clear all conversation history
     */
    clearConversationHistory(): void;
}

/**
 * Complete Robota interface combining core and configurable functionality
 * 
 * @public
 */
export interface RobotaComplete extends RobotaCore, RobotaConfigurable { } 