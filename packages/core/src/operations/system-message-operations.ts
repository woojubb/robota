import type { Message } from '../interfaces/ai-provider';
import type { SystemMessageManager } from '../managers/system-message-manager';
import type { RobotaConfigManager } from '../managers/robota-config-manager';

/**
 * 시스템 메시지 관련 순수 함수들
 * Robota 클래스의 시스템 메시지 관련 로직을 순수 함수로 분리
 */

/**
 * 시스템 프롬프트를 설정하는 순수 함수
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
 * 시스템 메시지들을 설정하는 순수 함수
 */
export function setSystemMessages(
    messages: Message[],
    systemMessageManager: SystemMessageManager
): void {
    systemMessageManager.setSystemMessages(messages);
}

/**
 * 시스템 메시지를 추가하는 순수 함수
 */
export function addSystemMessage(
    content: string,
    systemMessageManager: SystemMessageManager
): void {
    systemMessageManager.addSystemMessage(content);
}

/**
 * 시스템 메시지 설정을 적용하는 순수 함수
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