import type { ILogger } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';

/**
 * Web logger entrypoint for apps/web.
 *
 * IMPORTANT:
 * - Do not write to stdio by default (stdio can be used by upstream libraries).
 * - Inject a logger explicitly if you want debug output.
 */
export const WebLogger: ILogger = SilentLogger;


