import type { ToolProviderManager } from '../managers/tool-provider-manager';

/**
 * 도구 관련 순수 함수들
 * Robota 클래스의 도구 관련 로직을 순수 함수로 분리
 */

/**
 * 특정 도구를 직접 호출하는 순수 함수
 */
export async function callTool(
    toolName: string,
    parameters: Record<string, any>,
    toolProviderManager: ToolProviderManager
): Promise<any> {
    return toolProviderManager.callTool(toolName, parameters);
}

/**
 * 사용 가능한 모든 도구 목록을 가져오는 순수 함수
 */
export function getAvailableTools(
    toolProviderManager: ToolProviderManager
): any[] {
    return toolProviderManager.getAvailableTools();
} 