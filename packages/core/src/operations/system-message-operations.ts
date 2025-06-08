import type { Message } from '../interfaces/ai-provider';
import type { SystemMessageManager } from '../managers/system-message-manager';
import type { RobotaConfigManager } from '../managers/robota-config-manager';

/**
 * System message related pure functions
 * Separated system message related logic from Robota class into pure functions
 */

/**
 * Pure function to set system prompt
 */
export function setSystemPrompt(
    prompt: string,
    systemMessageManager: SystemMessageManager,
    configManager: RobotaConfigManager
): void {
    systemMessageManager.setSystemPrompt(prompt);
    configManager.updateSystemConfig({ systemPrompt: prompt });
}

/**
 * Pure function to set system messages
 */
export function setSystemMessages(
    messages: Message[],
    systemMessageManager: SystemMessageManager
): void {
    systemMessageManager.setSystemMessages(messages);
}

/**
 * Pure function to add system message
 */
export function addSystemMessage(
    content: string,
    systemMessageManager: SystemMessageManager
): void {
    systemMessageManager.addSystemMessage(content);
}

/**
 * Pure function to apply system message configuration
 */
export function applySystemMessageConfiguration(
    config: {
        systemPrompt?: string;
        systemMessages?: Message[];
    },
    systemMessageManager: SystemMessageManager
): void {
    if (config.systemPrompt) {
        systemMessageManager.setSystemPrompt(config.systemPrompt);
    } else if (config.systemMessages) {
        systemMessageManager.setSystemMessages(config.systemMessages);
    }
} 