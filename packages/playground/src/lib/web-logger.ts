import type { SimpleLogger } from '@robota-sdk/agents';
import { DefaultConsoleLogger } from '@robota-sdk/agents';

/**
 * Web logger entrypoint for apps/web.
 *
 * IMPORTANT:
 * - Do not use console.* directly in apps/web production code.
 * - Use this logger (or an injected SimpleLogger) instead.
 */
export const WebLogger: SimpleLogger = DefaultConsoleLogger;


