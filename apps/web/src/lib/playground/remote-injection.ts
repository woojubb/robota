/**
 * Remote Executor Injection for Robota Playground
 * 
 * This module transforms user code to automatically inject RemoteExecutor
 * for secure server-side execution without exposing actual API keys.
 */

// Import RemoteExecutor dynamically for web environment
// Dynamic import to avoid build issues with SSR
interface RemoteExecutorInterface {
    readonly name: string;
    readonly version: string;
    executeChat(request: any): Promise<any>;
    executeChatStream?(request: any): AsyncIterable<any>;
    supportsTools(): boolean;
    validateConfig(): boolean;
    dispose?(): Promise<void>;
}

export interface PlaygroundConfig {
    serverUrl: string;
    userApiKey: string;
    enableWebSocket?: boolean;
}

/**
 * Global playground executor instance
 * This is injected into the sandbox environment
 */
declare global {
    interface Window {
        __ROBOTA_PLAYGROUND_EXECUTOR__?: RemoteExecutorInterface;
        __ROBOTA_PLAYGROUND_CONFIG__?: PlaygroundConfig;
    }
}

/**
 * Transform user code to inject RemoteExecutor into all AI providers
 * 
 * @param userCode - Original user code from the playground editor
 * @param config - Playground configuration with server details
 * @returns Transformed code with RemoteExecutor injection
 */
export function injectRemoteExecutor(userCode: string, config: PlaygroundConfig): string {
    // Remove actual API key usage for security
    let transformedCode = removeApiKeyUsage(userCode);

    // Add RemoteExecutor import if not present
    transformedCode = addRemoteExecutorImport(transformedCode);

    // Inject executor into provider constructors
    transformedCode = injectExecutorIntoProviders(transformedCode);

    // Add playground configuration
    transformedCode = addPlaygroundConfig(transformedCode, config);

    return transformedCode;
}

/**
 * Remove direct API key usage from code for security
 */
function removeApiKeyUsage(code: string): string {
    return code
        // Remove OpenAI client API key
        .replace(
            /new OpenAI\(\s*{\s*apiKey:\s*['"'][^'"]*['"]\s*}\s*\)/g,
            'new OpenAI({ apiKey: "playground-mock-key" })'
        )
        // Remove Anthropic client API key
        .replace(
            /new Anthropic\(\s*{\s*apiKey:\s*['"'][^'"]*['"]\s*}\s*\)/g,
            'new Anthropic({ apiKey: "playground-mock-key" })'
        )
        // Remove environment variable API key usage
        .replace(
            /process\.env\.[A-Z_]*API_KEY/g,
            '"playground-mock-key"'
        )
        // Remove direct string API keys
        .replace(
            /apiKey:\s*['"']sk-[^'"]*['"']/g,
            'apiKey: "playground-mock-key"'
        );
}

/**
 * Add RemoteExecutor import to the code
 */
function addRemoteExecutorImport(code: string): string {
    // Check if RemoteExecutor is already imported
    if (code.includes('RemoteExecutor')) {
        return code;
    }

    // Find existing Robota imports
    const robotaImportMatch = code.match(/import\s*{([^}]+)}\s*from\s*['"]@robota-sdk\/agents['"];?/);

    if (robotaImportMatch) {
        // Add RemoteExecutor to existing import
        const existingImports = robotaImportMatch[1].trim();
        const newImports = existingImports.includes('RemoteExecutor')
            ? existingImports
            : `${existingImports}, RemoteExecutor`;

        return code.replace(
            robotaImportMatch[0],
            `import { ${newImports} } from '@robota-sdk/agents';`
        );
    } else {
        // Add new import at the beginning
        const importLine = `import { RemoteExecutor } from '@robota-sdk/agents';\n`;
        return importLine + code;
    }
}

/**
 * Inject executor into AI provider constructors
 */
function injectExecutorIntoProviders(code: string): string {
    let transformedCode = code;

    // OpenAI Provider injection
    transformedCode = transformedCode.replace(
        /new OpenAIProvider\(\s*({[^}]*})\s*\)/g,
        (match, configObj) => {
            // Parse existing config and add executor
            if (configObj.includes('executor:')) {
                return match; // Already has executor
            }

            // Add executor to config
            const newConfig = configObj.slice(0, -1) + (configObj.trim().endsWith(',') ? '' : ',') +
                '\n    executor: window.__ROBOTA_PLAYGROUND_EXECUTOR__\n  }';
            return `new OpenAIProvider(${newConfig})`;
        }
    );

    // Anthropic Provider injection
    transformedCode = transformedCode.replace(
        /new AnthropicProvider\(\s*({[^}]*})\s*\)/g,
        (match, configObj) => {
            if (configObj.includes('executor:')) {
                return match;
            }

            const newConfig = configObj.slice(0, -1) + (configObj.trim().endsWith(',') ? '' : ',') +
                '\n    executor: window.__ROBOTA_PLAYGROUND_EXECUTOR__\n  }';
            return `new AnthropicProvider(${newConfig})`;
        }
    );

    // Google Provider injection
    transformedCode = transformedCode.replace(
        /new GoogleProvider\(\s*({[^}]*})\s*\)/g,
        (match, configObj) => {
            if (configObj.includes('executor:')) {
                return match;
            }

            const newConfig = configObj.slice(0, -1) + (configObj.trim().endsWith(',') ? '' : ',') +
                '\n    executor: window.__ROBOTA_PLAYGROUND_EXECUTOR__\n  }';
            return `new GoogleProvider(${newConfig})`;
        }
    );

    return transformedCode;
}

/**
 * Add playground configuration setup
 */
function addPlaygroundConfig(code: string, config: PlaygroundConfig): string {
    const configSetup = `
// Playground configuration (auto-injected)
if (typeof window !== 'undefined') {
  window.__ROBOTA_PLAYGROUND_CONFIG__ = ${JSON.stringify(config, null, 2)};
  
  if (!window.__ROBOTA_PLAYGROUND_EXECUTOR__) {
    window.__ROBOTA_PLAYGROUND_EXECUTOR__ = new RemoteExecutor({
      serverUrl: '${config.serverUrl}',
      userApiKey: '${config.userApiKey}',
      enableWebSocket: ${config.enableWebSocket || false}
    });
  }
}
`;

    return configSetup + '\n' + code;
}

/**
 * Create a sandbox environment for secure code execution
 */
export function createPlaygroundSandbox(config: PlaygroundConfig): {
    execute: (code: string) => Promise<any>;
    cleanup: () => void;
} {
    // Create isolated context
    const sandbox = {
        console: {
            log: (...args: any[]) => console.log('[Playground]', ...args),
            error: (...args: any[]) => console.error('[Playground]', ...args),
            warn: (...args: any[]) => console.warn('[Playground]', ...args)
        },
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        fetch: window.fetch.bind(window),
        URL,
        Date,
        Math,
        JSON,
        Promise,
        // Playground-specific globals
        __ROBOTA_PLAYGROUND_CONFIG__: config,
        __ROBOTA_PLAYGROUND_EXECUTOR__: null as RemoteExecutorInterface | null
    };

    return {
        execute: async (code: string) => {
            try {
                // Note: In actual implementation, RemoteExecutor would be provided
                // by the playground runtime or imported dynamically in browser context
                sandbox.__ROBOTA_PLAYGROUND_EXECUTOR__ = {
                    name: 'remote',
                    version: '1.0.0',
                    executeChat: async () => ({ role: 'assistant', content: 'Mock response', timestamp: new Date() }),
                    executeChatStream: async function* () { yield { role: 'assistant', content: 'Mock', timestamp: new Date() }; },
                    supportsTools: () => true,
                    validateConfig: () => true,
                    dispose: async () => { }
                } as RemoteExecutorInterface;

                // Transform code for playground execution
                const transformedCode = injectRemoteExecutor(code, config);

                // Execute in sandbox context
                const func = new Function(...Object.keys(sandbox), transformedCode);
                return await func(...Object.values(sandbox));

            } catch (error) {
                console.error('Playground execution error:', error);
                throw error;
            }
        },
        cleanup: () => {
            if (sandbox.__ROBOTA_PLAYGROUND_EXECUTOR__) {
                sandbox.__ROBOTA_PLAYGROUND_EXECUTOR__.dispose?.();
                sandbox.__ROBOTA_PLAYGROUND_EXECUTOR__ = null;
            }
        }
    };
}

/**
 * Generate mock environment variables for playground
 */
export function generateMockEnvironment(): Record<string, string> {
    return {
        OPENAI_API_KEY: 'playground-mock-openai-key',
        ANTHROPIC_API_KEY: 'playground-mock-anthropic-key',
        GOOGLE_AI_API_KEY: 'playground-mock-google-key',
        NODE_ENV: 'playground'
    };
}

/**
 * Check if code requires transformation for playground
 */
export function requiresTransformation(code: string): boolean {
    return (
        code.includes('new OpenAIProvider') ||
        code.includes('new AnthropicProvider') ||
        code.includes('new GoogleProvider') ||
        code.includes('process.env.') ||
        /apiKey:\s*['"][^'"]*['"]/.test(code)
    );
}

/**
 * Preview transformed code for debugging
 */
export function previewTransformation(code: string, config: PlaygroundConfig): {
    original: string;
    transformed: string;
    changes: string[];
} {
    const changes: string[] = [];
    const transformed = injectRemoteExecutor(code, config);

    if (code !== transformed) {
        changes.push('Added RemoteExecutor injection');
        changes.push('Replaced API keys with mock values');
        changes.push('Added playground configuration');
    }

    return {
        original: code,
        transformed,
        changes
    };
}

/**
 * Extract provider information from code
 */
export function extractProviderInfo(code: string): {
    providers: string[];
    models: string[];
    hasTools: boolean;
    hasPlugins: boolean;
} {
    const providers: string[] = [];
    const models: string[] = [];

    if (code.includes('OpenAIProvider')) providers.push('openai');
    if (code.includes('AnthropicProvider')) providers.push('anthropic');
    if (code.includes('GoogleProvider')) providers.push('google');

    const modelMatches = code.match(/model:\s*['"]([^'"]+)['"]/g) || [];
    modelMatches.forEach(match => {
        const model = match.match(/['"]([^'"]+)['"]/)?.[1];
        if (model) models.push(model);
    });

    return {
        providers,
        models,
        hasTools: code.includes('addTool') || code.includes('createFunctionTool'),
        hasPlugins: code.includes('Plugin') && code.includes('new ')
    };
} 