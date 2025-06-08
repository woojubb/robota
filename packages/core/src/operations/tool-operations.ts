import type { ToolProviderManager } from '../managers/tool-provider-manager';

/**
 * Tool related pure functions
 * Separated tool related logic from Robota class into pure functions
 */

/**
 * Pure function to directly call specific tool
 */
export async function callTool(
    toolName: string,
    parameters: Record<string, any>,
    toolProviderManager: ToolProviderManager
): Promise<any> {
    return toolProviderManager.callTool(toolName, parameters);
}

/**
 * Pure function to get all available tools list
 */
export function getAvailableTools(
    toolProviderManager: ToolProviderManager
): any[] {
    return toolProviderManager.getAvailableTools();
} 