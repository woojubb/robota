/**
 * Sandbox environment for secure playground code execution
 */

import type { TUniversalValue } from '@robota-sdk/agents';
import type { IPlaygroundConfig } from './config-validation';

interface IRemoteExecutor {
    readonly name: string;
    readonly version: string;
    executeChat(request: Record<string, TUniversalValue>): Promise<TUniversalValue>;
    executeChatStream?(request: Record<string, TUniversalValue>): AsyncIterable<TUniversalValue>;
    supportsTools(): boolean;
    validateConfig(): boolean;
    dispose?(): Promise<void>;
}

type TSandboxLogArg = TUniversalValue | Error;

function formatLogArg(arg: TSandboxLogArg): string {
    if (arg instanceof Error) return arg.message;
    if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg, null, 2);
    return String(arg);
}

/**
 * Create a sandbox environment for secure code execution
 */
export function createPlaygroundSandbox(
    config: IPlaygroundConfig,
    transformCode: (code: string, config: IPlaygroundConfig) => string
): {
    execute: (code: string) => Promise<{ result: TUniversalValue; logs: string[] }>;
    cleanup: () => void;
} {
    const capturedLogs: string[] = [];

    const sandbox = {
        console: {
            log: (...args: TSandboxLogArg[]) => { capturedLogs.push(args.map(formatLogArg).join(' ')); },
            error: (...args: TSandboxLogArg[]) => { capturedLogs.push(`ERROR: ${args.map(formatLogArg).join(' ')}`); },
            warn: (...args: TSandboxLogArg[]) => { capturedLogs.push(`WARN: ${args.map(formatLogArg).join(' ')}`); }
        },
        setTimeout, setInterval, clearTimeout, clearInterval,
        fetch: window.fetch.bind(window),
        URL, Date, Math, JSON, Promise,
        process: {
            env: {
                OPENAI_API_KEY: 'playground-mock-key',
                ANTHROPIC_API_KEY: 'playground-mock-key',
                GOOGLE_API_KEY: 'playground-mock-key'
            }
        },
        __ROBOTA_PLAYGROUND_CONFIG__: config,
        __ROBOTA_PLAYGROUND_EXECUTOR__: null as IRemoteExecutor | null
    };

    return {
        execute: async (code: string) => {
            try {
                capturedLogs.length = 0;

                if (typeof window !== 'undefined' && window.__ROBOTA_PLAYGROUND_EXECUTOR__) {
                    sandbox.__ROBOTA_PLAYGROUND_EXECUTOR__ = window.__ROBOTA_PLAYGROUND_EXECUTOR__;
                } else {
                    throw new Error('Playground executor not initialized: window.__ROBOTA_PLAYGROUND_EXECUTOR__ is required');
                }

                const transformedCode = transformCode(code, config);
                const wrappedCode = `(async () => { ${transformedCode} })()`;

                // SECURITY: new Function() is used intentionally as a sandbox code execution mechanism.
                const func = new Function(...Object.keys(sandbox), `return ${wrappedCode}`);
                const result = await func(...Object.values(sandbox));

                return { result, logs: [...capturedLogs] };
            } catch (error) {
                capturedLogs.push(`ERROR: Playground execution error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        },
        cleanup: () => {
            if (sandbox.__ROBOTA_PLAYGROUND_EXECUTOR__) {
                sandbox.__ROBOTA_PLAYGROUND_EXECUTOR__.dispose?.();
                sandbox.__ROBOTA_PLAYGROUND_EXECUTOR__ = null;
            }
            capturedLogs.length = 0;
        }
    };
}
